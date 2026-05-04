/**
 * Scheduler — chrome.alarms based scheduling for recurring playbook execution.
 * Alarms survive service worker termination (Chrome wakes the worker on fire).
 */

import { STORAGE_KEYS } from '../shared/constants.js';
import { MSG } from '../shared/messages.js';
import * as Data from './data-store.js';
import { getTargetLinkedInTab } from './tab-selector.js';
import { withLock } from '../shared/lock.js';

const ALARM_PREFIX = 'playbook:';

const withSchedulesLock = (fn) => withLock(STORAGE_KEYS.SCHEDULES, fn);

// Tabs we explicitly created (and therefore explicitly injected) for
// scheduled runs. Tracked so we don't double-inject into tabs that
// already have the manifest content script wired up — a second
// executeScript would register a duplicate onMessage listener.
const tabsWeCreated = new Set();

/**
 * Initialize the scheduler — set up alarm listener and restore saved schedules.
 */
export function initScheduler() {
  // Listen for alarm events
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith(ALARM_PREFIX)) return;

    const playbookId = alarm.name.slice(ALARM_PREFIX.length);
    await triggerPlaybook(playbookId);
  });

  // Clean up our tracked-tab set when tabs go away.
  if (chrome.tabs?.onRemoved?.addListener) {
    chrome.tabs.onRemoved.addListener((tabId) => {
      tabsWeCreated.delete(tabId);
    });
  }

  // Restore alarms from saved schedules
  restoreSchedules();
}

/**
 * Set or update a schedule for a playbook.
 * @param {string} playbookId
 * @param {Object} config - { enabled: boolean, intervalMinutes: number }
 * @returns {Promise<void>}
 */
export async function setSchedule(playbookId, config) {
  await withSchedulesLock(async () => {
    const schedules = await getSchedules();
    schedules[playbookId] = {
      ...config,
      updatedAt: new Date().toISOString()
    };

    await saveSchedules(schedules);
  });

  const alarmName = ALARM_PREFIX + playbookId;

  if (config.enabled && config.intervalMinutes > 0) {
    chrome.alarms.create(alarmName, {
      periodInMinutes: config.intervalMinutes
    });
  } else {
    chrome.alarms.clear(alarmName);
  }
}

/**
 * Remove a schedule.
 * @param {string} playbookId
 * @returns {Promise<void>}
 */
export async function deleteSchedule(playbookId) {
  await withSchedulesLock(async () => {
    const schedules = await getSchedules();
    delete schedules[playbookId];
    await saveSchedules(schedules);
  });
  chrome.alarms.clear(ALARM_PREFIX + playbookId);
}

/**
 * Get all schedules.
 * @returns {Promise<Object>}
 */
export function getSchedules() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS.SCHEDULES, (result) => {
      resolve(result[STORAGE_KEYS.SCHEDULES] || {});
    });
  });
}

/**
 * Restore alarms from saved schedule data (for service worker restart).
 * Always recreates alarms so that changes to intervalMinutes take effect.
 */
async function restoreSchedules() {
  const schedules = await getSchedules();

  for (const [playbookId, config] of Object.entries(schedules)) {
    if (config.enabled && config.intervalMinutes > 0) {
      const alarmName = ALARM_PREFIX + playbookId;
      // Always recreate so updates to intervalMinutes take effect
      chrome.alarms.create(alarmName, { periodInMinutes: config.intervalMinutes });
    }
  }
}

/**
 * Trigger a playbook execution by finding or creating a LinkedIn tab.
 * @param {string} playbookId
 */
async function triggerPlaybook(playbookId) {
  try {
    // Prefer a LinkedIn tab matching the playbook's urlPattern over a random one.
    let targetTab = await getTargetLinkedInTab(playbookId);

    if (!targetTab) {
      // Determine the URL to open based on playbook
      const playbookUrl = await getPlaybookUrl(playbookId);
      targetTab = await chrome.tabs.create({ url: playbookUrl, active: false });
      // Track this tab as one we created so we don't double-inject — the
      // manifest content_scripts entry will load the content script when
      // the tab finishes loading.
      tabsWeCreated.add(targetTab.id);

      // Wait for tab to load
      await waitForTabComplete(targetTab.id);

      // Verify tab still exists after wait (user may have closed it)
      try {
        await chrome.tabs.get(targetTab.id);
      } catch {
        console.warn(`Scheduler: tab ${targetTab.id} closed before playbook could run`);
        tabsWeCreated.delete(targetTab.id);
        return;
      }

      // Give the manifest-loaded content script an extra moment to wire up
      // its onMessage listener before we send the run message.
      await new Promise(r => setTimeout(r, 1000));
    }

    // Send run message to content script and notify on completion
    chrome.tabs.sendMessage(targetTab.id, {
      type: MSG.RUN_PLAYBOOK,
      playbookId
    }, async (result) => {
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message || '';
        // If the content script isn't loaded, inject it and retry once.
        // Only do this for tabs we did NOT create — tabs we created get the
        // manifest content script loaded automatically and a second
        // executeScript would register a duplicate onMessage listener,
        // causing every subsequent message to be handled twice.
        if ((errMsg.includes('Could not establish connection') ||
             errMsg.includes('Receiving end does not exist')) &&
            !tabsWeCreated.has(targetTab.id)) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: targetTab.id },
              files: ['dist/content.bundle.js']
            });
            // Give the content script a moment to wire up its message listener
            await new Promise(r => setTimeout(r, 500));
            chrome.tabs.sendMessage(targetTab.id, {
              type: MSG.RUN_PLAYBOOK,
              playbookId
            }, (retryResult) => {
              handleRunResult(playbookId, retryResult);
            });
            return;
          } catch (injectErr) {
            console.warn(`Scheduler: injection failed for "${playbookId}":`, injectErr.message);
          }
        }
        console.warn(`Scheduler: sendMessage failed for "${playbookId}":`, errMsg);
        return;
      }
      handleRunResult(playbookId, result);
    });
  } catch (err) {
    console.error(`Scheduler: failed to trigger playbook "${playbookId}"`, err);

    chrome.notifications.create(`playbook-error-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'FusenLink',
      message: `Scheduled ${playbookId} failed: ${err.message}`
    });

    Data.logActivity({
      playbookId,
      action: 'scheduled_run',
      outcome: 'error',
      error: String(err.message).slice(0, 200)
    }).catch(() => {});
  }
}

/**
 * Handle the result of a playbook run: fire a notification and write to activity log.
 * Shared by the initial send path and the injection-retry path.
 * @param {string} playbookId
 * @param {Object|undefined} result
 */
function handleRunResult(playbookId, result) {
  const playbookName = playbookId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const processed = result?.data?.processedCount ?? result?.processedCount ?? 0;
  const skipped = result?.data?.skippedCount ?? result?.skippedCount ?? 0;
  const stopped = result?.data?.stopped || result?.stopped;
  const error = result?.data?.error || result?.error;
  const outcome = error ? 'error' : (stopped ? 'stopped' : 'complete');

  chrome.notifications.create(`playbook-done-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'FusenLink',
    message: `${playbookName} ${outcome}: ${processed} processed`
  });

  // Write to activity log so the History tab sees scheduled runs
  Data.logActivity({
    playbookId,
    action: 'scheduled_run',
    outcome,
    processedCount: processed,
    skippedCount: skipped,
    ...(error ? { error: String(error).slice(0, 200) } : {})
  }).catch((err) => console.debug('Scheduler: log write failed', err));

  // Update lastRun / lastOutcome on actual completion (not at dispatch time).
  withSchedulesLock(async () => {
    const schedules = await getSchedules();
    if (schedules[playbookId]) {
      schedules[playbookId].lastRun = new Date().toISOString();
      schedules[playbookId].lastOutcome = outcome;
      await saveSchedules(schedules);
    }
  }).catch((err) => console.debug('Scheduler: lastRun write failed', err));
}

/**
 * Get the appropriate LinkedIn URL for a playbook.
 * Derives URL from the playbook's urlPattern instead of a hardcoded map.
 * @param {string} playbookId
 * @returns {Promise<string>}
 */
async function getPlaybookUrl(playbookId) {
  // Try to load the playbook and use its scheduleUrl or derive from urlPattern
  try {
    const playbooks = await new Promise(resolve => {
      chrome.storage.local.get('playbooks', (r) => resolve(r.playbooks || {}));
    });
    const playbook = playbooks[playbookId];
    if (!playbook) return 'https://www.linkedin.com/mynetwork/invitation-manager/';

    // Prefer explicit scheduleUrl if defined on the playbook
    if (playbook.scheduleUrl) return playbook.scheduleUrl;

    // Derive from urlPattern by unescaping regex to a literal path
    if (playbook.urlPattern) {
      // Unescape regex: replace \\. with . and strip remaining regex metacharacters
      // but preserve dots that are already literal (after unescaping)
      const unescaped = playbook.urlPattern.replace(/\\\./g, '\x00');  // protect escaped dots
      const stripped = unescaped.replace(/[\\^$*+?|[\]{}()]/g, '');    // strip metacharacters (not dot)
      const path = stripped.replace(/\x00/g, '.');                      // restore dots

      if (path.includes('linkedin.com/')) {
        return `https://www.${path}`;
      }
      if (path.startsWith('/')) {
        return `https://www.linkedin.com${path}`;
      }
      return `https://www.linkedin.com/${path}`;
    }
  } catch (err) {
    console.warn('Scheduler: could not load playbook URL', err);
  }

  return 'https://www.linkedin.com/mynetwork/invitation-manager/';
}

/**
 * Wait for a tab to finish loading.
 * @param {number} tabId
 * @returns {Promise<void>}
 */
function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(updateListener);
      chrome.tabs.onRemoved.removeListener(removeListener);
      clearTimeout(timer);
    };

    const updateListener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    };
    const removeListener = (id) => {
      if (id === tabId) {
        cleanup();
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(updateListener);
    chrome.tabs.onRemoved.addListener(removeListener);

    // Timeout after 30 seconds
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, 30000);
  });
}

/**
 * Save schedules to storage.
 * @param {Object} schedules
 * @returns {Promise<void>}
 */
function saveSchedules(schedules) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.SCHEDULES]: schedules }, resolve);
  });
}
