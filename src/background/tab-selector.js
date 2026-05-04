/**
 * Shared helper for resolving the best LinkedIn tab to send a playbook
 * message to. Used by both the message router (RUN_PLAYBOOK / STOP /
 * STATUS handlers) and the scheduler (alarm-fired runs).
 */

import * as Store from './playbook-store.js';

/**
 * Resolve the best LinkedIn tab to send a playbook message to.
 * Priority:
 *   1. Active tab in the current window if it's on LinkedIn.
 *   2. A LinkedIn tab matching the playbook's urlPattern (when playbookId is provided).
 *   3. Any LinkedIn tab.
 * @param {string} [playbookId]
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
export async function getTargetLinkedInTab(playbookId) {
  // 1. Active tab in current window if on LinkedIn
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url && /^https?:\/\/[^/]*linkedin\.com\//.test(active.url)) {
    return active;
  }
  // 2. Any LinkedIn tab — prefer one matching the playbook's URL pattern
  const allLi = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
  if (playbookId) {
    const playbook = await Store.getPlaybook(playbookId);
    if (playbook?.urlPattern) {
      try {
        const pattern = new RegExp(playbook.urlPattern);
        const match = allLi.find(t => t.url && pattern.test(t.url));
        if (match) return match;
      } catch { /* invalid regex, ignore */ }
    }
  }
  return allLi[0] || null;
}
