/**
 * Updater — periodically fetches remote playbook/selector updates.
 *
 * SECURITY:
 *  - Only HTTPS URLs accepted.
 *  - Hostname must be in the configured allowlist (default: raw.githubusercontent.com).
 *  - validatePlaybook() only checks shape, NOT safety. A trusted update
 *    source is still required — there is no signature verification yet.
 *
 * TODO before re-enabling in production:
 *  - Ed25519 detached signature over the JSON payload, public key shipped with
 *    the extension build.
 *  - Audit playbook action surface — typeText/click/handleInviteModal can
 *    perform actions on the user's behalf if a malicious remote is trusted.
 */

import { STORAGE_KEYS } from '../shared/constants.js';
import { validatePlaybook } from '../shared/playbook-validator.js';
import { withLock } from '../shared/lock.js';

const UPDATE_ALARM = 'check-updates';
const UPDATE_INTERVAL_MINUTES = 1440; // 24 hours

const DEFAULT_ALLOWED_HOSTS = ['raw.githubusercontent.com'];

/**
 * Validate that an update URL is HTTPS and on the allowed hostname list.
 * @param {string} url
 * @param {string[]} allowedHosts
 * @returns {boolean}
 */
export function isValidUpdateUrl(url, allowedHosts = DEFAULT_ALLOWED_HOSTS) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return allowedHosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Initialize the updater.
 * @param {string} [updateUrl] - URL to fetch updates from (must be HTTPS and on allowedHosts)
 * @param {string[]} [allowedHosts] - Hostnames permitted as update sources (default: ['raw.githubusercontent.com'])
 */
export function initUpdater(updateUrl, allowedHosts = DEFAULT_ALLOWED_HOSTS) {
  if (!updateUrl) return;

  if (!isValidUpdateUrl(updateUrl, allowedHosts)) {
    console.warn('Updater: rejecting updateUrl — must be HTTPS and on the allowedHosts list:', updateUrl);
    return;
  }

  // Listen for the update alarm
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === UPDATE_ALARM) {
      await checkForUpdates(updateUrl, allowedHosts);
    }
  });

  // Create recurring alarm
  chrome.alarms.create(UPDATE_ALARM, {
    periodInMinutes: UPDATE_INTERVAL_MINUTES
  });

  // Check immediately on startup
  checkForUpdates(updateUrl, allowedHosts);
}

/**
 * Merge updates into the META storage key without clobbering existing fields.
 * @param {Object} updates
 */
async function recordUpdateMeta(updates) {
  return withLock(STORAGE_KEYS.META, async () => {
    const existing = await new Promise(resolve => {
      chrome.storage.local.get(STORAGE_KEYS.META, r => resolve(r[STORAGE_KEYS.META] || {}));
    });
    return new Promise(resolve => {
      chrome.storage.local.set({
        [STORAGE_KEYS.META]: { ...existing, ...updates }
      }, resolve);
    });
  });
}

/**
 * Record a fetch error into META so the UI can surface "remote unreachable".
 * @param {string} message
 */
async function recordUpdateError(message) {
  await recordUpdateMeta({
    lastFetchAt: new Date().toISOString(),
    lastFetchError: message
  });
}

/**
 * Fetch and merge remote updates.
 * @param {string} updateUrl
 * @param {string[]} allowedHosts
 */
export async function checkForUpdates(updateUrl, allowedHosts = DEFAULT_ALLOWED_HOSTS) {
  // Re-validate at fetch time (defense in depth — e.g. if called directly)
  if (!isValidUpdateUrl(updateUrl, allowedHosts)) {
    console.warn('Updater: rejecting fetch — URL not HTTPS or not in allowedHosts:', updateUrl);
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(updateUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      await recordUpdateMeta({ lastFetchAt: new Date().toISOString(), lastFetchError: `HTTP ${response.status}` });
      return;
    }

    // Record successful fetch before processing
    await recordUpdateMeta({ lastFetchAt: new Date().toISOString(), lastFetchError: null });

    const remote = await response.json();

    // Validate remote structure
    if (typeof remote !== 'object' || remote === null || Array.isArray(remote)) return;
    if (remote.playbooks && typeof remote.playbooks !== 'object') return;
    if (remote.selectors && typeof remote.selectors !== 'object') return;

    // Get current local data
    const local = await new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEYS.PLAYBOOKS, STORAGE_KEYS.SELECTORS], resolve);
    });

    const localPlaybooks = local[STORAGE_KEYS.PLAYBOOKS] || {};
    const localSelectors = local[STORAGE_KEYS.SELECTORS] || {};
    let changed = false;

    // Merge playbooks — only update if remote version is higher and valid
    if (remote.playbooks) {
      for (const [id, playbook] of Object.entries(remote.playbooks)) {
        if (!playbook || typeof playbook !== 'object' || !playbook.id || !playbook.name || !playbook.urlPattern || !Array.isArray(playbook.steps)) continue;
        const { valid } = validatePlaybook(playbook);
        if (!valid) {
          console.warn(`Updater: rejecting invalid remote playbook "${id}"`);
          continue;
        }
        const existing = localPlaybooks[id];
        if (!existing || (existing.version || 0) < (playbook.version || 0)) {
          localPlaybooks[id] = playbook;
          changed = true;
        }
      }
    }

    // Merge selector registries — only update if remote version is higher
    if (remote.selectors) {
      for (const [key, registry] of Object.entries(remote.selectors)) {
        if (!registry || typeof registry !== 'object') continue;
        const existing = localSelectors[key];
        if (!existing || (existing.version || 0) < (registry.version || 0)) {
          localSelectors[key] = registry;
          changed = true;
        }
      }
    }

    if (changed) {
      await recordUpdateMeta({
        lastFetchAt: new Date().toISOString(),
        lastFetchError: null,
        lastUpdate: new Date().toISOString()
      });
      await new Promise((resolve) => {
        chrome.storage.local.set({
          [STORAGE_KEYS.PLAYBOOKS]: localPlaybooks,
          [STORAGE_KEYS.SELECTORS]: localSelectors
        }, resolve);
      });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('Updater: failed to check for updates', err.message);
    await recordUpdateError(err.message);
  }
}
