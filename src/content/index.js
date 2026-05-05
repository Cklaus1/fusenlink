/**
 * ContentBridge — content script entry point.
 * Replaces the monolithic content.js with a thin orchestration layer
 * that loads playbooks from storage and delegates to the PlaybookEngine.
 */

import { PlaybookEngine } from './engine.js';
import { startWatching } from './url-watcher.js';
import { injectButtons, removeAllButtons } from '../ui/button-injector.js';
import { sendMessage, getSettings, storageGet } from '../shared/storage.js';
import { STORAGE_KEYS } from '../shared/constants.js';
import { MSG } from '../shared/messages.js';
import { DEFAULT_PLAYBOOKS } from '../defaults/playbooks.js';
import { DEFAULT_SELECTOR_REGISTRIES } from '../defaults/selectors.js';

let currentEngine = null;
let loadedPlaybooks = null;
let loadedSelectors = null;
let lastRunRequestedAt = 0;
const RUN_DEDUP_MS = 2000; // Ignore duplicate run requests within 2s

/**
 * Initialize the content script.
 */
async function initialize() {
  // Load playbooks and selectors from storage (with defaults fallback)
  await loadData();

  // Inject buttons for the current page
  injectForCurrentPage();

  // Auto-run any playbook requested via ?__fl-run=<id> (used by the
  // inbox-analysis result panel to hand off to per-thread playbooks).
  setTimeout(checkAutoRunParam, 1500);

  // Resume any in-flight bulk queue (e.g. user clicked "Star All" earlier
  // and we landed on /messaging/ between thread visits).
  setTimeout(resumeBulkQueueIfPending, 2000);

  // Watch for URL changes (LinkedIn SPA navigation)
  startWatching((newUrl) => {
    // Small delay to let LinkedIn render
    setTimeout(() => {
      removeAllButtons();
      injectForCurrentPage();
      checkAutoRunParam();
    }, 1000);
  });

  // Reload playbooks/selectors when storage changes (e.g., options page, remote update).
  // Use newValue from the change event directly for consistency across tabs.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const pbChange = changes[STORAGE_KEYS.PLAYBOOKS];
    const selChange = changes[STORAGE_KEYS.SELECTORS];
    if (!pbChange && !selChange) return;

    if (pbChange?.newValue) loadedPlaybooks = pbChange.newValue;
    if (selChange?.newValue) loadedSelectors = selChange.newValue;
    // Fall back to full reload if newValue is missing (deletion)
    if ((pbChange && !pbChange.newValue) || (selChange && !selChange.newValue)) {
      loadData().then(() => { removeAllButtons(); injectForCurrentPage(); });
    } else {
      removeAllButtons();
      injectForCurrentPage();
    }
  });

  // Listen for messages from background (e.g., scheduled runs)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === MSG.RUN_PLAYBOOK && message.playbookId) {
      runPlaybook(message.playbookId).then((result) => {
        sendResponse({ type: MSG.PLAYBOOK_STATUS, status: 'complete', data: result });
      });
      return true; // async response
    }

    if (message.type === MSG.STOP_PLAYBOOK) {
      if (currentEngine) {
        currentEngine.stop();
        sendResponse({ type: MSG.PLAYBOOK_STATUS, status: 'stopped' });
      } else {
        sendResponse({ type: MSG.PLAYBOOK_STATUS, status: 'idle' });
      }
      return true;
    }

    if (message.type === MSG.GET_STATUS) {
      sendResponse({
        type: MSG.PLAYBOOK_STATUS,
        status: currentEngine ? 'running' : 'idle'
      });
      return true;
    }

    // Live inbox name extraction (for reply detection)
    if (message.type === 'extractInboxNames') {
      const names = [];
      const profileUrls = [];

      // Walk up from each name node to its conversation card and try to extract
      // a /in/<slug> profile URL for that participant. Cards typically wrap an
      // anchor to /messaging/thread/... but the participant's profile URL may
      // appear on a sibling/inner anchor or in an avatar's href.
      const cards = document.querySelectorAll(
        '.msg-conversations-container__convo-item, ' +
        '.msg-conversation-listitem, ' +
        '.msg-conversation-card'
      );
      cards.forEach(card => {
        const nameEl = card.querySelector(
          '.msg-conversation-listitem__participant-names, ' +
          '[data-anonymize="person-name"], ' +
          'h3.msg-conversation-listitem__title'
        );
        const name = nameEl ? nameEl.textContent.trim() : '';
        if (!name) return;
        names.push(name);

        let slug = '';
        const profileAnchor = card.querySelector('a[href*="/in/"]');
        if (profileAnchor) {
          const m = profileAnchor.getAttribute('href').match(/\/in\/([^\/?#]+)/);
          if (m) slug = m[1];
        }
        profileUrls.push(slug || null);
      });

      // Fallback for layouts where there's no obvious card wrapper.
      if (names.length === 0) {
        const items = document.querySelectorAll(
          '.msg-conversation-listitem__participant-names, ' +
          '[data-anonymize="person-name"], ' +
          'h3.msg-conversation-listitem__title'
        );
        items.forEach(el => {
          const name = el.textContent.trim();
          if (!name) return;
          names.push(name);
          let slug = '';
          const anchor = el.closest('a[href*="/in/"]') ||
            el.closest('li, div')?.querySelector('a[href*="/in/"]');
          if (anchor) {
            const m = anchor.getAttribute('href').match(/\/in\/([^\/?#]+)/);
            if (m) slug = m[1];
          }
          profileUrls.push(slug || null);
        });
      }

      sendResponse({ names, profileUrls });
      return true;
    }
  });
}

/**
 * Load playbooks and selector registries from storage.
 */
async function loadData() {
  try {
    const data = await storageGet([STORAGE_KEYS.PLAYBOOKS, STORAGE_KEYS.SELECTORS]);
    loadedPlaybooks = data[STORAGE_KEYS.PLAYBOOKS] || DEFAULT_PLAYBOOKS;
    loadedSelectors = data[STORAGE_KEYS.SELECTORS] || DEFAULT_SELECTOR_REGISTRIES;
  } catch (err) {
    console.warn('ContentBridge: failed to load from storage, using defaults', err);
    loadedPlaybooks = DEFAULT_PLAYBOOKS;
    loadedSelectors = DEFAULT_SELECTOR_REGISTRIES;
  }
}

/**
 * Inject buttons for playbooks that match the current page URL.
 */
async function injectForCurrentPage() {
  if (!loadedPlaybooks) await loadData();

  const settings = await getSettings();
  injectButtons(loadedPlaybooks, settings, (playbookId) => {
    runPlaybook(playbookId);
  });
}

/**
 * Run a playbook by ID.
 * @param {string} playbookId
 * @returns {Promise<Object>} Run results
 */
async function runPlaybook(playbookId) {
  // Prevent multiple concurrent runs and rapid double-clicks
  const now = Date.now();
  if (currentEngine || (now - lastRunRequestedAt) < RUN_DEDUP_MS) {
    console.warn('ContentBridge: playbook already running or duplicate request');
    return { error: 'already_running' };
  }
  lastRunRequestedAt = now;

  const playbook = loadedPlaybooks[playbookId];
  if (!playbook) {
    console.error(`ContentBridge: playbook "${playbookId}" not found`);
    return { error: 'not_found' };
  }

  // Get the selector registry for this playbook
  const registryKey = playbook.selectors;
  const selectorRegistry = loadedSelectors[registryKey] || {};

  // Get user settings to merge with playbook defaults
  const settings = await getSettings();
  const mergedSettings = {
    ...playbook.settings,
    maxItems: settings.maxInvites ?? playbook.settings?.maxItems ?? 50,
    delayMs: settings.delayMs ?? playbook.settings?.delayMs ?? 1500
  };

  // Create and run the engine
  currentEngine = new PlaybookEngine(playbook, selectorRegistry, mergedSettings);

  try {
    const result = await currentEngine.run();
    // After completion, if there's a pending bulk queue and this run was the
    // current bulk item, advance to the next one.
    advanceBulkQueue(playbookId).catch(err => console.warn('bulk queue advance failed:', err));
    return result;
  } catch (err) {
    console.error('ContentBridge: playbook error', err);
    return { error: err.message };
  } finally {
    currentEngine = null;
  }
}

/**
 * Bulk-action queue: when the inbox-analysis result panel kicks off a
 * "Star All" or "Move all to Other" over multiple conversations, it stores
 * { playbookId, names, index } in chrome.storage.local under 'pendingBulk'.
 * After each playbook completion, this advances the queue: navigates to the
 * next conversation by clicking its inbox-sidebar card, then re-runs the
 * playbook with ?__fl-run=. When the queue is empty, clears the storage
 * entry and shows a brief overlay summary.
 */
async function advanceBulkQueue(justRanPlaybookId) {
  const { pendingBulk } = await new Promise((resolve) =>
    chrome.storage.local.get(['pendingBulk'], resolve)
  );
  if (!pendingBulk || pendingBulk.playbookId !== justRanPlaybookId) return;
  // The just-completed run was at pendingBulk.index. Bump to next.
  const nextIndex = (pendingBulk.index || 0) + 1;
  if (nextIndex >= (pendingBulk.names || []).length) {
    // Done — clean up.
    await new Promise((resolve) => chrome.storage.local.remove(['pendingBulk'], resolve));
    console.log(`[bulk] complete: ${pendingBulk.names.length} conversations`);
    return;
  }
  const updated = { ...pendingBulk, index: nextIndex };
  await new Promise((resolve) => chrome.storage.local.set({ pendingBulk: updated }, resolve));

  // Navigate to /messaging/ root briefly to ensure the inbox sidebar is
  // visible (we need it to find the next conversation card). After that we
  // poll for the card and click it.
  const targetName = pendingBulk.names[nextIndex];
  console.log(`[bulk] ${nextIndex + 1}/${pendingBulk.names.length} → ${targetName}`);
  await navigateToInboxAndRunNext(targetName, pendingBulk.playbookId);
}

async function navigateToInboxAndRunNext(targetName, playbookId) {
  // If we're already on a thread page, the sidebar should still be present.
  // Just look for the card by name and click it.
  const items = Array.from(document.querySelectorAll('li.msg-conversation-listitem'));
  const target = String(targetName || '').trim().toLowerCase();
  let card = items.find((it) => {
    const n = it.querySelector('.msg-conversation-listitem__participant-names')?.textContent || '';
    return n.trim().toLowerCase() === target;
  });
  // If not found on this page, navigate to inbox root and try again after load.
  if (!card) {
    window.location.href = `https://www.linkedin.com/messaging/`;
    return; // page-load handler will retry once the sidebar is up
  }
  const link = card.querySelector('.msg-conversation-listitem__link') || card;
  const before = location.href;
  link.click();
  // Poll for URL change.
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
 * On every page boot, if a bulk queue is pending and the current page is
 * the inbox root (no thread open), advance to the current item. This
 * handles the case where the queue's first or any next-item navigation
 * lands us back at /messaging/.
 */
async function resumeBulkQueueIfPending() {
  const { pendingBulk } = await new Promise((resolve) =>
    chrome.storage.local.get(['pendingBulk'], resolve)
  );
  if (!pendingBulk || !pendingBulk.names || pendingBulk.index >= pendingBulk.names.length) return;
  if (/\/messaging\/thread\//.test(location.href) && new URLSearchParams(location.search).get('__fl-run')) return;
  // Not on a thread or no auto-run param yet — give the sidebar a moment, then click.
  setTimeout(() => {
    navigateToInboxAndRunNext(pendingBulk.names[pendingBulk.index], pendingBulk.playbookId)
      .catch(err => console.warn('bulk resume failed:', err));
  }, 2500);
}

/**
 * If the URL carries ?__fl-run=<playbookId>, fire that playbook once and
 * scrub the param so a manual reload doesn't re-trigger it. Used by the
 * AI panel's per-item action buttons to hand off from inbox-analysis to
 * star-thread / mark-as-other / draft-reply on a specific thread.
 */
function checkAutoRunParam() {
  let id;
  try {
    const params = new URLSearchParams(location.search);
    id = params.get('__fl-run');
    if (!id) return;
    // Scrub the param immediately so retries / reloads don't re-fire.
    params.delete('__fl-run');
    const qs = params.toString();
    const newUrl = location.pathname + (qs ? `?${qs}` : '') + location.hash;
    history.replaceState(history.state, '', newUrl);
  } catch {
    return;
  }
  if (!loadedPlaybooks || !loadedPlaybooks[id]) return;
  // Defer one tick so the user sees the navigation land before the panel pops.
  setTimeout(() => { runPlaybook(id); }, 200);
}

// Initialize on various load events to handle LinkedIn's SPA behavior
function boot() {
  initialize().catch(err => console.error('ContentBridge init error:', err));
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  boot();
} else {
  document.addEventListener('DOMContentLoaded', boot);
}

// Also handle window load as a fallback
window.addEventListener('load', () => {
  // Re-inject buttons if they were removed (LinkedIn sometimes clears DOM)
  if (loadedPlaybooks) {
    setTimeout(() => injectForCurrentPage(), 1000);
  }
});
