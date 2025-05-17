/**
 * LinkedIn Bulk Actions - Settings Utility
 * Provides an interface for interacting with extension settings
 */

/**
 * Get current extension settings
 * @returns {Promise<{maxInvites: number, delayMs: number}>} The current settings
 */
export async function getSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      resolve(response);
    });
  });
}

/**
 * Update extension settings
 * @param {Object} settingsPatch - The settings to update
 * @param {number} [settingsPatch.maxInvites] - Max invites to send
 * @param {number} [settingsPatch.delayMs] - Delay between actions in ms
 * @returns {Promise<{success: boolean}>} Success status
 */
export async function updateSettings(settingsPatch) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'setSettings',
      settings: settingsPatch
    }, (response) => {
      resolve(response);
    });
  });
}