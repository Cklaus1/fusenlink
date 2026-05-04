/**
 * Chrome storage helpers with proper error handling.
 * Fixes bug #3: lib/settings.js didn't handle chrome.runtime.lastError,
 * causing undefined responses and 0ms rapid-fire clicks.
 */

import { DEFAULT_SETTINGS } from './constants.js';

/**
 * Send a message to the background service worker with error handling.
 * @param {Object} message - The message to send
 * @returns {Promise<any>} The response, or a safe fallback
 */
export function sendMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('Message error:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        resolve(response ?? null);
      });
    } catch (err) {
      console.warn('sendMessage failed:', err.message);
      resolve(null);
    }
  });
}

/**
 * Get extension settings with guaranteed defaults.
 * @returns {Promise<{maxInvites: number, delayMs: number}>}
 */
export async function getSettings() {
  const response = await sendMessage({ action: 'getSettings' });
  if (response && typeof response.maxInvites === 'number' && typeof response.delayMs === 'number') {
    return response;
  }
  return { ...DEFAULT_SETTINGS };
}

/**
 * Update extension settings.
 * @param {Object} patch - Settings fields to update
 * @returns {Promise<{success: boolean}>}
 */
export async function updateSettings(patch) {
  const response = await sendMessage({ action: 'setSettings', settings: patch });
  return response || { success: false };
}

/**
 * Read from chrome.storage.local with error handling.
 * @param {string|string[]} keys - Storage key(s) to read
 * @returns {Promise<Object>} The stored data
 */
export function storageGet(keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          console.warn('storage.get error:', chrome.runtime.lastError.message);
          resolve({});
          return;
        }
        resolve(result || {});
      });
    } catch (err) {
      console.warn('storageGet failed:', err.message);
      resolve({});
    }
  });
}

/**
 * Write to chrome.storage.local with error handling.
 * @param {Object} data - Key-value pairs to store
 * @returns {Promise<boolean>} Success status
 */
export function storageSet(data) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) {
          console.warn('storage.set error:', chrome.runtime.lastError.message);
          resolve(false);
          return;
        }
        resolve(true);
      });
    } catch (err) {
      console.warn('storageSet failed:', err.message);
      resolve(false);
    }
  });
}

/**
 * Remove from chrome.storage.local with error handling.
 * @param {string|string[]} keys - Key(s) to remove
 * @returns {Promise<boolean>} Success status
 */
export function storageRemove(keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) {
          console.warn('storage.remove error:', chrome.runtime.lastError.message);
          resolve(false);
          return;
        }
        resolve(true);
      });
    } catch (err) {
      console.warn('storageRemove failed:', err.message);
      resolve(false);
    }
  });
}
