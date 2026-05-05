/**
 * AIPanel — rich overlay for AI results, approval dialogs, and multi-option prompts.
 * Used by the 'prompt' engine action for trust-level review workflows.
 */

let panelElement = null;
let pendingResolve = null; // Track pending promise to prevent orphan on double-call

/**
 * Show a prompt dialog and wait for user selection.
 * @param {Object} options
 * @param {string} options.title - Dialog title
 * @param {string|Object} options.body - Content body. Plain string/object renders as
 *   pre-formatted text. An object with `__type: 'inbox-analysis-result'` renders
 *   a structured result with per-item action buttons (Star / Move / Draft Reply).
 * @param {string[]} options.options - Array of button labels
 * @returns {Promise<string>} The selected option label
 */
export function showPrompt({ title, body, options }) {
  return new Promise((resolve) => {
    if (pendingResolve) {
      pendingResolve(null);
      pendingResolve = null;
    }
    removePanel();
    pendingResolve = resolve;

    panelElement = document.createElement('div');
    panelElement.id = 'li-bulk-ai-panel';
    Object.assign(panelElement.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      backgroundColor: 'white',
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
      padding: '24px',
      zIndex: '10000',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      maxWidth: '640px',
      width: '92%',
      maxHeight: '82vh',
      overflow: 'auto',
      border: '1px solid #e0e0e0'
    });

    const backdrop = document.createElement('div');
    backdrop.id = 'li-bulk-ai-backdrop';
    Object.assign(backdrop.style, {
      position: 'fixed',
      top: '0', left: '0', right: '0', bottom: '0',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      zIndex: '9999'
    });

    const titleEl = document.createElement('h3');
    titleEl.textContent = title || 'AI Result';
    Object.assign(titleEl.style, {
      margin: '0 0 12px 0',
      color: '#0a66c2',
      fontSize: '18px',
      fontWeight: 'bold'
    });
    panelElement.appendChild(titleEl);

    // Rich rendering for known structured result shapes; fall back to text.
    if (body && typeof body === 'object' && body.__type === 'inbox-analysis-result') {
      panelElement.appendChild(renderInboxResult(body));
    } else if (body && typeof body === 'object' && body.__type === 'draft-reply-result') {
      panelElement.appendChild(renderDraftReply(body));
    } else {
      panelElement.appendChild(renderTextBody(body));
    }

    const buttonsEl = document.createElement('div');
    Object.assign(buttonsEl.style, {
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      marginTop: '16px'
    });

    for (const option of (options || ['OK'])) {
      const btn = document.createElement('button');
      btn.textContent = option;
      Object.assign(btn.style, {
        padding: '8px 16px',
        borderRadius: '20px',
        border: '1px solid #0a66c2',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: '600',
        backgroundColor: option === options[0] ? '#0a66c2' : 'white',
        color: option === options[0] ? 'white' : '#0a66c2',
        transition: 'background-color 0.2s'
      });
      btn.addEventListener('click', () => {
        pendingResolve = null;
        removePanel();
        backdrop.remove();
        resolve(option);
      });
      buttonsEl.appendChild(btn);
    }

    panelElement.appendChild(buttonsEl);
    document.body.appendChild(backdrop);
    document.body.appendChild(panelElement);
  });
}

function renderTextBody(body) {
  const bodyEl = document.createElement('div');
  Object.assign(bodyEl.style, {
    whiteSpace: 'pre-wrap',
    fontSize: '14px',
    lineHeight: '1.5',
    color: '#333'
  });
  const MAX_BODY_LENGTH = 10000;
  let display;
  if (typeof body === 'object') {
    try { display = JSON.stringify(body, null, 2); } catch { display = '[Unable to serialize]'; }
  } else {
    display = String(body || '');
  }
  if (display.length > MAX_BODY_LENGTH) display = display.slice(0, MAX_BODY_LENGTH) + '\n... (truncated)';
  bodyEl.textContent = display;
  return bodyEl;
}

/**
 * Render the inbox-analysis result with per-item action buttons.
 * The body shape is { __type, classification: {digest, highPriority, lowPriority, spam}, conversations }.
 * Each highPriority/lowPriority/spam item is matched to a conversation by name to recover threadUrl,
 * then rendered as a row with action buttons that navigate to the thread with a query param the
 * thread-page bundle uses to auto-fire the corresponding playbook.
 */
function renderInboxResult(body) {
  const { classification = {}, conversations = [] } = body;
  const wrap = document.createElement('div');
  wrap.style.fontSize = '14px';
  wrap.style.color = '#333';

  // name -> conversation lookup, case-insensitive trim
  const byName = {};
  for (const c of conversations) {
    if (c && c.name) byName[String(c.name).trim().toLowerCase()] = c;
  }
  const lookup = (name) => byName[String(name || '').trim().toLowerCase()] || null;

  if (classification.digest) {
    const digest = document.createElement('p');
    digest.textContent = classification.digest;
    Object.assign(digest.style, {
      margin: '0 0 16px 0',
      padding: '10px 12px',
      background: '#f3f6f8',
      borderLeft: '3px solid #0a66c2',
      borderRadius: '4px',
      lineHeight: '1.5'
    });
    wrap.appendChild(digest);
  }

  // Action order in each section is intentional — the FIRST action is the
  // recommended one for that bucket and renders as a filled-blue primary
  // button; subsequent actions render as outlined ghost buttons. The eye
  // lands on the action the user is most likely to take.
  const sections = [
    { key: 'highPriority', label: 'High Priority', actions: ['reply', 'star'] },
    { key: 'lowPriority', label: 'Low Priority', actions: ['reply', 'star'] },
    { key: 'spam', label: 'Spam', actions: ['move'] }
  ];

  // Bulk actions per section. The first action in `bulk` (if any) renders as
  // a small button next to the section heading and runs that playbook for
  // every item in the section sequentially via a chrome.storage queue.
  const sectionsWithBulk = sections.map((s) => {
    if (s.key === 'highPriority') return { ...s, bulk: { action: 'star', label: '⭐ Star All' } };
    if (s.key === 'lowPriority') return { ...s, bulk: { action: 'move', label: '📦 Move all to Other' } };
    if (s.key === 'spam') return { ...s, bulk: { action: 'move', label: '📦 Move all to Other' } };
    return s;
  });

  for (const sec of sectionsWithBulk) {
    const items = classification[sec.key] || [];
    if (!Array.isArray(items) || items.length === 0) continue;

    // Heading row: label + bulk button (right-aligned)
    const headerRow = document.createElement('div');
    Object.assign(headerRow.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      margin: '14px 0 6px 0'
    });
    const h = document.createElement('h4');
    h.textContent = `${sec.label} (${items.length})`;
    Object.assign(h.style, {
      margin: '0',
      fontSize: '13px',
      color: '#666',
      textTransform: 'uppercase',
      letterSpacing: '0.5px'
    });
    headerRow.appendChild(h);

    if (sec.bulk) {
      const playbookId = sec.bulk.action === 'star' ? 'star-thread'
        : sec.bulk.action === 'move' ? 'mark-as-other'
        : null;
      if (playbookId) {
        const bulkBtn = document.createElement('button');
        bulkBtn.textContent = sec.bulk.label;
        Object.assign(bulkBtn.style, {
          padding: '4px 10px',
          borderRadius: '14px',
          border: '1px solid #d0d0d0',
          background: 'white',
          color: '#0a66c2',
          fontSize: '11px',
          fontWeight: '600',
          cursor: 'pointer',
          whiteSpace: 'nowrap'
        });
        bulkBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          startBulk(items.map((it) => it.name), playbookId, sec.label);
        });
        headerRow.appendChild(bulkBtn);
      }
    }
    wrap.appendChild(headerRow);

    for (const item of items) {
      wrap.appendChild(renderItemRow(item, lookup(item.name), sec.actions));
    }
  }

  return wrap;
}

function renderItemRow(item, conv, actions) {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '10px 0',
    borderBottom: '1px solid #eee'
  });

  const text = document.createElement('div');
  text.style.flex = '1';
  text.style.minWidth = '0';

  const name = document.createElement('div');
  name.textContent = item.name || '(no name)';
  name.style.fontWeight = '600';
  name.style.marginBottom = '2px';
  text.appendChild(name);

  const reason = item.reason || item.suggestedAction || '';
  if (reason) {
    const r = document.createElement('div');
    r.textContent = reason;
    Object.assign(r.style, {
      fontSize: '13px',
      color: '#555',
      lineHeight: '1.4'
    });
    text.appendChild(r);
  }
  row.appendChild(text);

  const btns = document.createElement('div');
  Object.assign(btns.style, { display: 'flex', gap: '6px', flexShrink: '0' });

  // The first action is the recommended one — render filled-blue (primary);
  // others are outlined ghost buttons. Buttons no longer depend on a pre-
  // extracted threadUrl: at click time we look the conversation card up by
  // name on the page, click it (LinkedIn updates location.href), then
  // navigate with ?__fl-run=<id>. Robust against the conversation cards
  // being divs without href (the 2026 lite UI).
  const mkBtn = (label, playbookId, title, primary) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title || label;
    Object.assign(b.style, {
      padding: '5px 12px',
      borderRadius: '14px',
      border: primary ? '1px solid #0a66c2' : '1px solid #d0d0d0',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: primary ? '600' : '500',
      background: primary ? '#0a66c2' : 'white',
      color: primary ? 'white' : '#444',
      whiteSpace: 'nowrap',
      transition: 'background-color 0.15s, transform 0.05s'
    });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      runActionByName(item.name, playbookId);
    });
    return b;
  };

  const actionMap = {
    star: (primary) => mkBtn('⭐ Star', 'star-thread', 'Open thread + toggle star', primary),
    reply: (primary) => mkBtn('📝 Reply', 'draft-reply', 'Open thread + AI-draft a reply', primary),
    move: (primary) => mkBtn('📦 Move to Other', 'mark-as-other', 'Open thread + move to Other inbox', primary)
  };
  actions.forEach((act, i) => {
    const make = actionMap[act];
    if (make) btns.appendChild(make(i === 0)); // first = primary
  });
  row.appendChild(btns);
  return row;
}

/**
 * Render the draft-reply result with two (or however many) labeled draft
 * blocks. Each draft shows a tone badge and the body text. The user picks
 * Send #1 / Send #2 from the bottom button row.
 */
function renderDraftReply(body) {
  const drafts = (body && body.drafts && Array.isArray(body.drafts.options))
    ? body.drafts.options
    : [];
  const wrap = document.createElement('div');
  wrap.style.fontSize = '14px';
  wrap.style.color = '#333';

  if (drafts.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No drafts returned. Cancel and try again.';
    empty.style.color = '#a00';
    wrap.appendChild(empty);
    return wrap;
  }

  drafts.forEach((d, i) => {
    const card = document.createElement('div');
    Object.assign(card.style, {
      padding: '12px 14px',
      marginBottom: '10px',
      border: '1px solid #e0e0e0',
      borderRadius: '8px',
      background: '#fafbfc'
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '8px'
    });
    const num = document.createElement('strong');
    num.textContent = `#${i + 1}`;
    num.style.color = '#0a66c2';
    header.appendChild(num);

    if (d.tone) {
      const badge = document.createElement('span');
      badge.textContent = d.tone;
      Object.assign(badge.style, {
        padding: '2px 8px',
        borderRadius: '10px',
        background: '#0a66c2',
        color: 'white',
        fontSize: '11px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      });
      header.appendChild(badge);
    }
    card.appendChild(header);

    const text = document.createElement('div');
    text.textContent = d.text || '(empty draft)';
    Object.assign(text.style, {
      lineHeight: '1.5',
      whiteSpace: 'pre-wrap'
    });
    card.appendChild(text);
    wrap.appendChild(card);
  });

  return wrap;
}

/**
 * Find a conversation card in the inbox sidebar by participant name, click
 * its inner link to make LinkedIn navigate to that thread, then once the URL
 * has updated re-navigate with ?__fl-run=<playbookId> so the thread-page
 * bundle auto-fires the playbook on init.
 *
 * Conversation cards in the 2026 lite UI are <div>s without an href, so we
 * can't extract a thread URL up front — clicking the card and reading
 * location.href afterwards is the most reliable way to derive it.
 */
async function runActionByName(name, playbookId) {
  const target = String(name || '').trim().toLowerCase();
  const items = Array.from(document.querySelectorAll('li.msg-conversation-listitem'));
  const card = items.find((it) => {
    const n = it.querySelector('.msg-conversation-listitem__participant-names')?.textContent || '';
    return n.trim().toLowerCase() === target;
  });
  if (!card) {
    console.warn(`AIPanel: no conversation card found for "${name}"`);
    return;
  }
  const link = card.querySelector('.msg-conversation-listitem__link') || card;
  const before = location.href;
  link.click();
  // Poll for URL change up to 3s, then navigate with the param.
  const started = Date.now();
  while (Date.now() - started < 3000) {
    if (location.href !== before && /\/messaging\/thread\//.test(location.href)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const u = new URL(location.href);
  u.searchParams.set('__fl-run', playbookId);
  window.location.href = u.toString();
}

/**
 * Kick off a bulk action over a list of conversation names. Stores the
 * queue in chrome.storage.local so it survives page navigations; the
 * thread-page bundle pops the next item after each playbook completes
 * (see src/content/index.js advanceBulkQueue).
 */
async function startBulk(names, playbookId, sectionLabel) {
  if (!names || names.length === 0) return;
  const proceed = window.confirm(
    `Run "${playbookId}" on ${names.length} ${sectionLabel.toLowerCase()} conversation${names.length === 1 ? '' : 's'}?\n\nThis will visit each thread sequentially.`
  );
  if (!proceed) return;
  await new Promise((resolve) => {
    chrome.storage.local.set({
      'pendingBulk': {
        playbookId,
        names: names.slice(),
        index: 0,
        startedAt: new Date().toISOString()
      }
    }, resolve);
  });
  // Kick off the first item.
  runActionByName(names[0], playbookId);
}

/**
 * Show an AI result display (non-blocking, with dismiss).
 */
export function showResult({ title, content }) {
  return showPrompt({ title, body: content, options: ['Done'] });
}

export function removePanel() {
  const el = panelElement;
  panelElement = null;
  if (el && el.parentNode) el.parentNode.removeChild(el);
  const backdrop = document.getElementById('li-bulk-ai-backdrop');
  if (backdrop) backdrop.remove();
}
