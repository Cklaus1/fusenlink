/**
 * Popup UI — FusenLink toolbar with Playbooks, Schedule, History tabs.
 *
 * PM improvements:
 * #1 AI results viewer in History tab (profile reviews, inbox analysis data)
 * #2 Export button for extracted data
 * #3 Running state banner with Stop button
 * #4 "Go to LinkedIn" button when not on LinkedIn
 * #5 Schedule interval selector
 * #6 Human-readable names in history
 * #7 Test Connection in options (handled in options.js)
 * #8 Inbox processedCount (handled in playbooks.js)
 */

import { PLAYBOOK_URLS, DEFAULT_DAILY_LIMITS, timeAgo } from '../shared/constants.js';

// ==================== DATE HELPERS (Bug 1) ====================

function localDateString(d = new Date()) {
  const y = d.getFullYear();
  if (y < 2020 || y > 2050) {
    // System clock looks wrong — fall back to UTC for consistency
    console.warn(`localDateString: suspicious year ${y}, using UTC fallback`);
    return d.toISOString().slice(0, 10);
  }
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isToday(timestamp) {
  if (!timestamp) return false;
  return localDateString(new Date(timestamp)) === localDateString();
}

// --- DOM refs ---
const playbooksList = document.getElementById('playbooks');
const scheduleList = document.getElementById('scheduleList');
const historyList = document.getElementById('historyList');
const dataSection = document.getElementById('dataSection');
const statusEl = document.getElementById('status');
const aiBanner = document.getElementById('aiBanner');
const runningBanner = document.getElementById('runningBanner');
const runningText = document.getElementById('runningText');
const stopBtn = document.getElementById('stopBtn');

// --- Init ---
document.getElementById('settingsLink').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('setupAI')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    try {
      if (tab.dataset.tab === 'pipeline') loadPipeline();
      if (tab.dataset.tab === 'cohort') loadCohort();
      if (tab.dataset.tab === 'schedule') loadSchedules();
      if (tab.dataset.tab === 'history') loadHistory();
    } catch (err) {
      console.error(`Failed to load tab "${tab.dataset.tab}":`, err);
    }
  });
});

// Stop button
stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stopPlaybook' }, () => {
    runningBanner.classList.remove('active');
    setStatus('Stopped');
  });
});

// --- State ---
let aiReady = false;
let allPlaybooks = {};
let dailyLimits = { ...DEFAULT_DAILY_LIMITS };

// Boot: load limits via message API (Bug 8), check AI, then load playbooks
chrome.runtime.sendMessage({ action: 'getDailyLimits' }, (result) => {
  if (!chrome.runtime.lastError && result) {
    dailyLimits = { ...DEFAULT_DAILY_LIMITS, ...result };
  }

  let booted = false;
  const boot = (status) => {
    if (booted) return;
    booted = true;
    if (status?.configured && status?.reachable) aiReady = true;
    if (!aiReady) aiBanner.classList.add('active');
    checkRunningState();
    loadPlaybooks();
  };

  chrome.runtime.sendMessage({ action: 'aiStatus' }, (status) => {
    if (chrome.runtime.lastError) boot(null);
    else boot(status);
  });

  // Fallback in case the SW is slow
  setTimeout(() => boot(null), 1500);
});

// Bug 8: reflect CLI-driven dailyLimits changes in open popup
// Bug 13: bust pipeline cache when activity log / sequences / contacts change
// Bug 25: capture listener reference so it can be removed on beforeunload
const storageHandler = (changes, area) => {
  if (area !== 'local') return;
  if (changes.dailyLimits) {
    dailyLimits = { ...DEFAULT_DAILY_LIMITS, ...changes.dailyLimits.newValue };
    loadPlaybooks(); // re-render to update limit labels
  }
  if (changes['data.activityLog'] || changes['data.sequences'] || changes['data.contacts']) {
    pipelineCache = null;
    pipelineCacheAt = 0;
  }
};
chrome.storage.onChanged.addListener(storageHandler);
window.addEventListener('beforeunload', () => {
  chrome.storage.onChanged.removeListener(storageHandler);
});

// Bug 5: quota banner
chrome.storage.local.get('meta.quota', (result) => {
  const q = result['meta.quota'];
  if (q && q.ratio > 0.8) {
    showQuotaBanner(q);
  }
});

// Bug 28: migration banner — show one-line notice if any migration ran today
chrome.storage.local.get('meta', (result) => {
  const meta = result.meta || {};
  const log = meta.migrations || [];
  if (log.length === 0) return;
  const todayISO = localDateString();
  const todayMigrations = log.filter(e => {
    if (!e.migratedAt) return false;
    return localDateString(new Date(e.migratedAt)) === todayISO;
  });
  if (todayMigrations.length === 0) return;
  showMigrationBanner(todayMigrations.length);
});

function showQuotaBanner(q) {
  let banner = document.getElementById('quotaBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'quotaBanner';
    banner.className = 'banner banner-warn';
    Object.assign(banner.style, {
      background: '#fff3cd',
      border: '1px solid #ffc107',
      borderRadius: '4px',
      padding: '6px 10px',
      fontSize: '12px',
      marginBottom: '6px'
    });
    document.body.insertBefore(banner, document.body.firstChild);
  }
  const pct = Math.round(q.ratio * 100);
  banner.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = `Storage ${pct}% full (${(q.bytes / 1024 / 1024).toFixed(1)} MB of ${(q.limit / 1024 / 1024).toFixed(0)} MB). `;
  banner.appendChild(span);
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = 'Export & cleanup';
  link.addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
  banner.appendChild(link);
}

function showMigrationBanner(count) {
  let banner = document.getElementById('migrationBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'migrationBanner';
    Object.assign(banner.style, {
      padding: '8px 12px',
      background: '#e7f3ff',
      borderLeft: '3px solid #0a66c2',
      fontSize: '12px',
      color: '#333'
    });
    document.body.insertBefore(banner, document.body.firstChild);
  }
  banner.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = `${count} update${count > 1 ? 's' : ''} applied today. `;
  banner.appendChild(span);
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = 'View details';
  link.style.cursor = 'pointer';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  banner.appendChild(link);
}

// ==================== RUNNING STATE (#3) ====================

function checkRunningState() {
  // Bug 30: show placeholder banner immediately so user sees "Checking…" instead of stale "Ready"
  runningText.textContent = 'Checking status...';
  runningBanner.classList.add('active');

  chrome.runtime.sendMessage({ action: 'getPlaybookStatus' }, (result) => {
    if (!chrome.runtime.lastError && result?.status === 'running') {
      runningText.textContent = 'Playbook running...';
    } else {
      // Status is idle (or unknown) — remove the placeholder
      runningBanner.classList.remove('active');
    }
  });
}

// ==================== PLAYBOOKS TAB ====================

function loadPlaybooks() {
  chrome.runtime.sendMessage({ action: 'getAllPlaybooks' }, (playbooks) => {
    if (chrome.runtime.lastError || !playbooks) {
      setStatus('Failed to load playbooks', true);
      return;
    }
    allPlaybooks = playbooks;
    playbooksList.innerHTML = '';

    // Fetch today's counts for all playbooks in one pass
    // Bug 21: use limit:0 (falsy → no slice in data-store) so old entries don't fall off
    chrome.runtime.sendMessage({
      action: 'getData', collection: 'activityLog', options: { limit: 0 }
    }, (logData) => {
      const todayCounts = {};
      // Bug 4: skip checkpoint rows (in_progress), dedupe by runId keeping highest processedCount
      const entries = logData?.entries || [];
      // Group by playbookId → runId → highest processedCount
      const byPlaybookRun = {}; // { playbookId: Map<runId, entry> }
      for (const e of entries) {
        if (!isToday(e.timestamp)) continue;
        if (e.outcome === 'in_progress') continue; // skip checkpoints
        const pid = e.playbookId;
        if (!byPlaybookRun[pid]) byPlaybookRun[pid] = new Map();
        const runMap = byPlaybookRun[pid];
        if (!e.runId) {
          // Legacy entries without runId — count directly
          runMap.set(`legacy:${e.id || Math.random()}`, e);
        } else {
          const existing = runMap.get(e.runId);
          if (!existing || (e.processedCount || 0) > (existing.processedCount || 0)) {
            runMap.set(e.runId, e);
          }
        }
      }
      for (const [pid, runMap] of Object.entries(byPlaybookRun)) {
        todayCounts[pid] = Array.from(runMap.values()).reduce((s, e) => s + (e.processedCount || 0), 0);
      }

      for (const [id, pb] of Object.entries(playbooks)) {
        const li = document.createElement('li');
        li.className = 'pitem';

        const info = document.createElement('div');
        info.className = 'pinfo';

        const limit = dailyLimits[id];
        const used = todayCounts[id] || 0;
        const limitText = limit ? ` \u2022 ${used}/${limit} today` : '';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'pname';
        nameDiv.textContent = pb.name;
        const descDiv = document.createElement('div');
        descDiv.className = 'pdesc';
        descDiv.textContent = getPageHint(id, pb) + limitText;
        info.appendChild(nameDiv);
        info.appendChild(descDiv);

        const right = document.createElement('div');
        right.className = 'pright';

        const needsAI = pb.settings?.requiresAI;
        if (needsAI) {
          const badge = document.createElement('span');
          badge.className = 'badge badge-ai';
          badge.textContent = 'AI';
          if (!aiReady) badge.style.opacity = '0.4';
          right.appendChild(badge);
        }

        const atLimit = limit && used >= limit;
        const btn = document.createElement('button');
        btn.className = 'run-btn';
        btn.textContent = atLimit ? 'Limit' : 'Run';
        if ((needsAI && !aiReady) || atLimit) {
          btn.disabled = true;
          btn.title = atLimit ? `Daily limit reached (${used}/${limit})` : 'Configure AI in Settings first';
        }
        btn.addEventListener('click', (e) => { e.stopPropagation(); runPlaybook(id, pb, btn); });
        right.appendChild(btn);

        li.appendChild(info);
        li.appendChild(right);
        playbooksList.appendChild(li);
      }
    });
  });
}

function getPageHint(id, pb) {
  const url = PLAYBOOK_URLS[id];
  if (!url) return pb.description || 'Any profile page';
  if (url.includes('invitation-manager')) return 'Invitation Manager';
  if (url.includes('search/results')) return 'Search Results';
  if (url.includes('connections')) return 'Connections page';
  if (url.includes('messaging')) return 'Messaging';
  return pb.description || '';
}

async function runPlaybook(id, pb, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  clearStatus();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // #4: "Go to LinkedIn" button instead of dead-end error
  if (!tab?.url?.includes('linkedin.com')) {
    statusEl.textContent = '';
    statusEl.appendChild(document.createTextNode('Not on LinkedIn. '));
    const goBtn = document.createElement('button');
    goBtn.className = 'link-btn';
    goBtn.textContent = 'Open LinkedIn';
    goBtn.addEventListener('click', () => {
      const url = PLAYBOOK_URLS[id] || 'https://www.linkedin.com/';
      chrome.tabs.update(tab.id, { url });
      window.close();
    });
    statusEl.appendChild(goBtn);
    resetBtn(btn);
    return;
  }

  // Daily limit check
  const todayCount = await getTodayCount(id);
  const limit = getDailyLimit(id);
  if (limit && todayCount >= limit) {
    setStatus(`Daily limit reached (${todayCount}/${limit})`, true);
    resetBtn(btn);
    return;
  }

  // Navigate if needed
  const requiredUrl = PLAYBOOK_URLS[id];
  if (requiredUrl) {
    const norm = (s) => s.replace(/\/+$/, '');  // strip trailing slashes
    const requiredPath = norm(new URL(requiredUrl).pathname);
    const onCorrectPage = requiredPath && tab.url.includes(requiredPath);
    if (!onCorrectPage) {
      setStatus('Navigating...');
      await chrome.tabs.update(tab.id, { url: requiredUrl });
      await waitForTabLoad(tab.id);
      await sleep(2000);
    }
  }

  // Show running state
  runningBanner.classList.add('active');
  runningText.textContent = `Running ${pb.name}...`;

  chrome.runtime.sendMessage({ action: 'runPlaybook', playbookId: id }, (result) => {
    runningBanner.classList.remove('active');
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, true);
    } else if (result?.error) {
      if (result.error === 'already_running') {
        // Bug 30: friendly message + button to focus the running tab
        statusEl.textContent = '';
        statusEl.appendChild(document.createTextNode('Already running \u2014 '));
        const focusBtn = document.createElement('button');
        focusBtn.className = 'link-btn';
        focusBtn.textContent = 'Open LinkedIn tab';
        focusBtn.addEventListener('click', () => {
          chrome.tabs.query({ url: '*://*.linkedin.com/*' }, (tabs) => {
            if (tabs?.[0]?.id) chrome.tabs.update(tabs[0].id, { active: true });
          });
          window.close();
        });
        statusEl.appendChild(focusBtn);
      } else if (isAIError(result.error)) {
        statusEl.textContent = '';
        statusEl.appendChild(document.createTextNode('AI unreachable \u2014 '));
        const fixLink = document.createElement('a');
        fixLink.textContent = 'check settings';
        fixLink.style.cursor = 'pointer';
        fixLink.addEventListener('click', () => chrome.runtime.openOptionsPage());
        statusEl.appendChild(fixLink);
      } else {
        setStatus(result.error, true);
      }
    } else {
      const limitNote = limit ? ` (${todayCount + 1}/${limit} today)` : '';
      setStatus(`Started!${limitNote} Check the LinkedIn tab.`);
      // Leave popup open — user closes manually so the response can update the UI safely
    }
    resetBtn(btn);
  });
}

// ==================== PIPELINE TAB ====================

// Bug 31: cache pipeline data for 30s to avoid refetching on every tab click
let pipelineCache = null;
let pipelineCacheAt = 0;
const PIPELINE_CACHE_MS = 30_000;

function loadPipeline() {
  if (pipelineCache && (Date.now() - pipelineCacheAt) < PIPELINE_CACHE_MS) {
    renderPipeline(pipelineCache);
    return;
  }

  // Gather data from multiple sources
  Promise.all([
    msgPromise({ action: 'getData', collection: 'contacts', options: {} }).catch(() => ({})),
    msgPromise({ action: 'getData', collection: 'outreach', options: {} }).catch(() => ({})),
    msgPromise({ action: 'getData', collection: 'activityLog', options: { limit: 500 } }).catch(() => ({})),
    msgPromise({ action: 'getSequences' }).catch(() => ({}))
  ]).then((data) => {
    pipelineCache = data;
    pipelineCacheAt = Date.now();
    renderPipeline(data);
  });
}

function renderPipeline(data) {
  const [contacts, outreach, activityLog, sequences] = data;
  const funnelEl = document.getElementById('pipelineFunnel');
  const seqEl = document.getElementById('pipelineSequences');
  const recentEl = document.getElementById('pipelineRecent');
  funnelEl.innerHTML = '';
  seqEl.innerHTML = '';
  recentEl.innerHTML = '';

  {
    // Count funnel stages
    const leads = contacts?.items ? Object.keys(contacts.items).length : 0;
    const outreachEntries = outreach?.entries || [];
    const contacted = outreachEntries.filter(e => e.action === 'message_sent').length;

    // Count replies from activity log
    const logEntries = activityLog?.entries || [];
    const replies = logEntries.filter(e => e.action === 'reply_detected').length;

    // Bug 22: count distinct contacts across all sequences (stats.sent double-counts multi-step contacts)
    let seqContacted = 0, seqReplied = 0, seqCompleted = 0;
    const seqItems = sequences?.items || {};
    for (const seq of Object.values(seqItems)) {
      for (const c of Object.values(seq.contacts || {})) {
        if (c.messages?.length > 0) seqContacted++;
        if (c.status === 'replied') seqReplied++;
        if (c.status === 'completed') seqCompleted++;
      }
    }

    const totalContacted = contacted + seqContacted;
    const totalReplied = replies + seqReplied;
    const replyRate = totalContacted > 0 ? Math.round((totalReplied / totalContacted) * 100) : 0;
    const contactRate = leads > 0 ? Math.round((totalContacted / leads) * 100) : 0;

    // Funnel
    funnelEl.innerHTML = `
      <div class="funnel">
        <div class="funnel-stage f-leads">
          <div class="funnel-count">${leads}</div>
          <div class="funnel-label">Leads</div>
        </div>
        <div class="funnel-stage f-contacted">
          <div class="funnel-count">${totalContacted}</div>
          <div class="funnel-label">Contacted</div>
          <div class="funnel-rate">${contactRate}%</div>
        </div>
        <div class="funnel-stage f-replied">
          <div class="funnel-count">${totalReplied}</div>
          <div class="funnel-label">Replied</div>
          <div class="funnel-rate">${replyRate}%</div>
        </div>
        <div class="funnel-stage f-meeting">
          <div class="funnel-count">—</div>
          <div class="funnel-label">Meetings</div>
          <div class="funnel-rate">track manually</div>
        </div>
      </div>`;

    // Sequences section
    const seqEntries = Object.entries(seqItems);
    if (seqEntries.length > 0) {
      seqEl.innerHTML = '<div class="section-title">Active Sequences</div>';
      for (const [id, seq] of seqEntries) {
        const s = seq.stats || {};
        const rate = s.sent > 0 ? Math.round((s.replied / s.sent) * 100) : 0;
        const active = Object.values(seq.contacts).filter(c => c.status === 'active').length;
        seqEl.innerHTML += `
          <div class="sitem">
            <div>
              <div class="sname">${esc(seq.name)}</div>
              <div class="smeta">${s.enrolled} enrolled \u2022 ${s.sent} sent \u2022 ${s.replied} replied (${rate}%) \u2022 ${active} waiting</div>
            </div>
          </div>`;
      }
    }

    // Recent activity
    const recentReplies = logEntries
      .filter(e => e.action === 'reply_detected')
      .slice(-5)
      .reverse();

    if (recentReplies.length > 0) {
      recentEl.innerHTML = '<div class="section-title">Recent Replies</div>';
      for (const r of recentReplies) {
        recentEl.innerHTML += `
          <div class="hitem">
            <span class="hname">${esc(r.details?.name || 'Unknown')}</span>
            <span class="htime">${timeAgo(r.timestamp)}</span>
            <div class="hresult ok">Replied — sequence stopped</div>
          </div>`;
      }
    } else if (leads === 0 && totalContacted === 0) {
      recentEl.innerHTML = '<div class="empty">Run "Extract Leads" from a search page to start building your pipeline.</div>';
    }
  }
}

function msgPromise(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, (result) => {
      resolve(chrome.runtime.lastError ? {} : result);
    });
  });
}

// ==================== COHORT TAB ====================

function loadCohort() {
  const el = document.getElementById('cohortContent');
  el.innerHTML = '<div class="empty">Loading cohort data...</div>';

  Promise.all([
    msgPromise({ action: 'getCohort' }),
    msgPromise({ action: 'getLeaderboard' }),
    msgPromise({ action: 'getContentCalendar' }),
    msgPromise({ action: 'getSharedTemplates' })
  ]).then(([cohort, leaderboard, calendar, templates]) => {
    el.innerHTML = '';

    const members = cohort.members || [];
    if (members.length === 0) {
      el.innerHTML = '<div class="empty">No cohort configured.<br>Go to Settings > Accelerator Cohort to add your cohort members.</div>';
      return;
    }

    // Header
    el.innerHTML += `<div class="section-title">${esc(cohort.cohort || cohort.name || 'My Cohort')} \u2022 ${members.length} members</div>`;

    // Content Calendar
    if (calendar.calendar && Object.keys(calendar.calendar).length > 0) {
      let calHtml = '<div class="section-title">Content Calendar</div><div style="margin-bottom:10px">';
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
      for (const day of days) {
        const posters = calendar.calendar[day] || [];
        const isToday = day === calendar.dayName;
        if (posters.length > 0) {
          calHtml += `<div style="font-size:10px;margin:3px 0"><strong>${day.charAt(0).toUpperCase() + day.slice(1)}${isToday ? ' (today)' : ''}:</strong> `;
          calHtml += posters.map(s =>
            `<span class="calendar-day ${isToday ? 'today' : 'other'}">${esc(s)}</span>`
          ).join(' ');
          calHtml += '</div>';
        }
      }
      if (calendar.isYourDay) {
        calHtml += '<div style="font-size:11px;color:#0a66c2;font-weight:600;margin-top:4px">It\'s your posting day! Use "AI Draft Post" to create content.</div>';
      }
      calHtml += '</div>';
      el.innerHTML += calHtml;
    }

    // Leaderboard
    if (leaderboard && Object.keys(leaderboard).length > 0) {
      el.innerHTML += '<div class="section-title">Leaderboard (This Week)</div>';

      for (const [category, scores] of Object.entries(leaderboard)) {
        const label = category.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        let rows = Object.entries(scores)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);

        if (rows.length > 0) {
          let lbHtml = `<div style="font-size:10px;color:#888;margin:6px 0 3px">${esc(label)}</div>`;
          rows.forEach(([name, score], i) => {
            const isYou = name === (cohort.mySlug || '');
            lbHtml += `<div class="lb-row${isYou ? ' you' : ''}">
              <span class="lb-rank">${i + 1}</span>
              <span class="lb-name">${esc(name)}${isYou ? ' (you)' : ''}</span>
              <span class="lb-stat">${score}</span>
            </div>`;
          });
          el.innerHTML += lbHtml;
        }
      }
    }

    // Shared Templates
    if (templates && templates.length > 0) {
      el.innerHTML += '<div class="section-title">Shared Templates</div>';
      for (const tmpl of templates) {
        el.innerHTML += `<div class="template-item" title="${esc(tmpl.text)}">
          ${esc(tmpl.name)} ${tmpl.category ? `<span style="color:#888">(${esc(tmpl.category)})</span>` : ''}
          ${tmpl.replyRate ? `<span class="template-rate">${tmpl.replyRate}% reply</span>` : ''}
        </div>`;
      }
    }

    // Warm Intro (check current page)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url || '';
      if (url.includes('/in/')) {
        chrome.runtime.sendMessage({ action: 'detectWarmIntros', targetProfileUrl: url }, (intros) => {
          if (chrome.runtime.lastError || !el.parentNode) return;
          if (intros && intros.length > 0) {
            let introHtml = '<div class="section-title">Warm Intros Available</div>';
            for (const intro of intros) {
              introHtml += `<div class="intro-item">
                <span class="intro-name">${esc(intro.memberName)}</span>
                ${intro.memberCompany ? `at ${esc(intro.memberCompany)}` : ''}
                is connected to this person
              </div>`;
            }
            el.innerHTML += introHtml;
          }
        });
      }
    });

    // Sync status
    if (cohort.lastSynced) {
      el.innerHTML += `<div style="font-size:9px;color:#aaa;text-align:center;margin-top:8px">Last synced: ${timeAgo(cohort.lastSynced)}</div>`;
    }
  });
}

// ==================== SCHEDULE TAB (#5: interval selector) ====================

const INTERVALS = [
  { value: 60, label: 'Hourly' },
  { value: 240, label: '4 hours' },
  { value: 480, label: '8 hours' },
  { value: 1440, label: 'Daily' },
  { value: 10080, label: 'Weekly' }
];

function loadSchedules() {
  chrome.runtime.sendMessage({ action: 'getAllPlaybooks' }, (playbooks) => {
    if (chrome.runtime.lastError || !playbooks) return;
    chrome.runtime.sendMessage({ action: 'getSchedules' }, (schedules) => {
      if (chrome.runtime.lastError) return;
      scheduleList.innerHTML = '';
      const sched = schedules || {};

      for (const [id, pb] of Object.entries(playbooks || {})) {
        const config = sched[id] || { enabled: false, intervalMinutes: 1440 };
        const item = document.createElement('div');
        item.className = 'sitem';

        const info = document.createElement('div');
        const sname = document.createElement('div');
        sname.className = 'sname';
        sname.textContent = pb.name;
        const smeta = document.createElement('div');
        smeta.className = 'smeta';
        smeta.textContent = config.lastRun ? `Last: ${timeAgo(config.lastRun)}` : 'Never run';
        info.appendChild(sname);
        info.appendChild(smeta);

        const right = document.createElement('div');
        right.className = 'sright';

        // Interval dropdown
        const select = document.createElement('select');
        select.className = 'interval';
        for (const opt of INTERVALS) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          if (opt.value === (config.intervalMinutes || 1440)) o.selected = true;
          select.appendChild(o);
        }
        select.addEventListener('change', () => {
          chrome.runtime.sendMessage({
            action: 'setSchedule',
            playbookId: id,
            config: { enabled: config.enabled, intervalMinutes: parseInt(select.value) }
          }, () => loadSchedules());
        });
        right.appendChild(select);

        // Toggle
        const toggle = document.createElement('button');
        toggle.className = `toggle${config.enabled ? ' on' : ''}`;
        toggle.addEventListener('click', () => {
          chrome.runtime.sendMessage({
            action: 'setSchedule',
            playbookId: id,
            config: { enabled: !config.enabled, intervalMinutes: parseInt(select.value) }
          }, () => loadSchedules());
        });
        right.appendChild(toggle);

        item.appendChild(info);
        item.appendChild(right);
        scheduleList.appendChild(item);
      }
    });
  });
}

// ==================== HISTORY TAB (#1, #2, #6) ====================

function loadHistory() {
  // Load activity log
  chrome.runtime.sendMessage({
    action: 'getData', collection: 'activityLog', options: { limit: 50 }
  }, (data) => {
    historyList.innerHTML = '';
    const entries = (data?.entries || []).slice().reverse();

    if (entries.length === 0) {
      historyList.innerHTML = '<div class="empty">No activity yet. Run a playbook to see history.</div>';
    } else {
      // #6: Show human names
      for (const entry of entries) {
        const item = document.createElement('div');
        item.className = 'hitem';
        const humanName = allPlaybooks[entry.playbookId]?.name || entry.playbookId;
        const cls = entry.outcome === 'complete' ? 'ok' :
                    entry.outcome === 'error' ? 'error' : 'stopped';
        const processed = entry.processedCount ?? 0;
        const skipped = entry.skippedCount ? ` (${entry.skippedCount} skipped)` : '';
        const dur = entry.durationMs ? ` in ${(entry.durationMs / 1000).toFixed(0)}s` : '';
        const row = document.createElement('div');
        const hname = document.createElement('span');
        hname.className = 'hname';
        hname.textContent = humanName;
        const htime = document.createElement('span');
        htime.className = 'htime';
        htime.textContent = timeAgo(entry.timestamp);
        row.appendChild(hname);
        row.appendChild(document.createTextNode(' '));
        row.appendChild(htime);
        const result = document.createElement('div');
        result.className = `hresult ${cls}`;
        if (entry.outcome === 'error' && entry.error) {
          result.textContent = `Error: ${String(entry.error).slice(0, 80)}`;
        } else {
          result.textContent = `${processed} processed${skipped}${dur}`;
        }
        // CSS class fallback in case `.hresult.error` isn't defined
        if (entry.outcome === 'error') result.style.color = '#d11124';
        item.appendChild(row);
        item.appendChild(result);
        historyList.appendChild(item);
      }
    }

    // #1 + #2: Show stored data with preview and export
    loadDataPreviews();
  });
}

function loadDataPreviews() {
  dataSection.innerHTML = '';

  const collections = [
    { key: 'profileReviews', label: 'Profile Reviews', format: 'json' },
    { key: 'inbox', label: 'Inbox Analysis', format: 'json' },
    { key: 'contacts', label: 'Extracted Contacts', format: 'csv' },
    { key: 'outreach', label: 'Outreach Messages', format: 'json' }
  ];

  // Also show sequence stats
  chrome.runtime.sendMessage({ action: 'getSequences' }, (seqData) => {
    if (chrome.runtime.lastError) return;
    const items = seqData?.items || {};
    for (const [id, seq] of Object.entries(items)) {
      if (seq.stats?.enrolled > 0) {
        const section = document.createElement('div');
        section.className = 'data-section';
        const s = seq.stats;
        const replyRate = s.sent > 0 ? Math.round((s.replied / s.sent) * 100) : 0;
        const header = document.createElement('div');
        header.className = 'data-header';
        const title = document.createElement('span');
        title.className = 'data-title';
        title.textContent = `Sequence: ${seq.name}`;
        header.appendChild(title);
        const preview = document.createElement('div');
        preview.className = 'data-preview';
        preview.textContent = `${s.enrolled} enrolled \u2022 ${s.sent} sent \u2022 ${s.replied} replied (${replyRate}%) \u2022 ${s.completed} completed\nStatus: ${seq.status}`;
        section.appendChild(header);
        section.appendChild(preview);
        dataSection.appendChild(section);
      }
    }
  });

  let loadedCount = 0;

  for (const col of collections) {
    chrome.runtime.sendMessage({
      action: 'getData', collection: col.key, options: { limit: 5 }
    }, (data) => {
      loadedCount++;
      if (chrome.runtime.lastError || !data) return;

      const hasData = data.items ? Object.keys(data.items).length > 0 :
                      data.entries ? data.entries.length > 0 :
                      data.data ? true : false;

      if (hasData) {
        const section = document.createElement('div');
        section.className = 'data-section';

        const header = document.createElement('div');
        header.className = 'data-header';
        header.innerHTML = `<span class="data-title">${col.label}</span>`;

        // Export button
        const exportBtn = document.createElement('button');
        exportBtn.className = 'export-btn';
        exportBtn.textContent = col.format === 'csv' ? 'Export CSV' : 'Copy JSON';
        exportBtn.addEventListener('click', () => exportData(col.key, col.format, col.label));
        header.appendChild(exportBtn);

        // Preview
        const preview = document.createElement('div');
        preview.className = 'data-preview';
        preview.textContent = formatPreview(data, col.key);

        section.appendChild(header);
        section.appendChild(preview);
        dataSection.appendChild(section);
      }

      // Add empty state if nothing found after all loads
      if (loadedCount === collections.length && dataSection.children.length === 0) {
        // No data stored yet — that's fine, just show history
      }
    });
  }
}

function formatPreview(data, collection) {
  if (collection === 'contacts' && data.items) {
    const items = Object.values(data.items).slice(0, 3);
    return items.map(c => `${c.name || 'Unknown'} — ${c.headline || ''}`).join('\n')
      + (Object.keys(data.items).length > 3 ? `\n... and ${Object.keys(data.items).length - 3} more` : '');
  }
  if (collection === 'inbox' && data.data) {
    const d = data.data;
    if (d.digest) return d.digest;
    if (d.highPriority) return `${d.highPriority.length} high priority, ${d.lowPriority?.length || 0} low, ${d.spam?.length || 0} spam`;
    return JSON.stringify(d, null, 2).slice(0, 200);
  }
  if (collection === 'outreach' && data.entries) {
    const sent = data.entries.length;
    const recent = data.entries.slice(-3).map(e => `${e.name || 'Unknown'} — ${e.action || 'sent'}`);
    return `${sent} messages sent\n${recent.join('\n')}`;
  }
  if (collection === 'profileReviews' && data.data) {
    const d = data.data;
    if (d.score) return `Score: ${d.score}/100\n${d.summary || ''}`;
    if (d.summary) return d.summary;
    return JSON.stringify(d, null, 2).slice(0, 200);
  }
  return JSON.stringify(data, null, 2).slice(0, 200);
}

function exportData(collection, format, label) {
  chrome.runtime.sendMessage({
    action: 'getData', collection, options: { format }
  }, (data) => {
    let content, filename, mimeType;

    if (format === 'csv' && data.csv) {
      content = data.csv;
      filename = `fusenlink-${collection}.csv`;
      mimeType = 'text/csv';
    } else {
      content = JSON.stringify(data, null, 2);
      filename = `fusenlink-${collection}.json`;
      mimeType = 'application/json';
    }

    // Copy to clipboard (simpler in popup context than file download)
    navigator.clipboard.writeText(content).then(() => {
      setStatus(`${label} copied to clipboard!`);
    }).catch(() => {
      // Fallback: open in new tab
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      chrome.tabs.create({ url }, () => URL.revokeObjectURL(url));
    });
  });
}

// ==================== HELPERS ====================

function getTodayCount(playbookId) {
  return new Promise(resolve => {
    // Bug 21: limit:0 → no slice in data-store so historical entries don't crowd out today's
    // Bug 4: skip checkpoints (in_progress) and dedupe by runId keeping highest processedCount
    chrome.runtime.sendMessage({
      action: 'getData', collection: 'activityLog', options: { limit: 0 }
    }, (data) => {
      const byRun = new Map();
      for (const e of (data?.entries || [])) {
        if (e.playbookId !== playbookId) continue;
        if (!isToday(e.timestamp)) continue;
        if (e.outcome === 'in_progress') continue; // skip checkpoints
        if (!e.runId) {
          byRun.set(`legacy:${e.id || Math.random()}`, e);
        } else {
          const existing = byRun.get(e.runId);
          if (!existing || (e.processedCount || 0) > (existing.processedCount || 0)) {
            byRun.set(e.runId, e);
          }
        }
      }
      const total = Array.from(byRun.values()).reduce((sum, e) => sum + (e.processedCount || 0), 0);
      resolve(total);
    });
  });
}

function getDailyLimit(id) {
  return dailyLimits[id] || null;
}

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(updateListener);
      chrome.tabs.onRemoved.removeListener(removeListener);
      clearTimeout(timer);
      resolve();
    };
    const updateListener = (id, info) => { if (id === tabId && info.status === 'complete') cleanup(); };
    const removeListener = (id) => { if (id === tabId) cleanup(); };
    chrome.tabs.onUpdated.addListener(updateListener);
    chrome.tabs.onRemoved.addListener(removeListener);
    const timer = setTimeout(cleanup, 15000);
  });
}


function isAIError(err) {
  return err?.includes('ECONNREFUSED') || err?.includes('abort') || err?.includes('fetch');
}

function setStatus(text, isError = false) { statusEl.textContent = text; statusEl.classList.toggle('error', isError); }
function clearStatus() { statusEl.textContent = ''; statusEl.classList.remove('error'); }
function resetBtn(btn) { btn.disabled = false; btn.textContent = 'Run'; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
