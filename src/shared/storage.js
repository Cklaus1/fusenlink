/**
 * Chrome storage helpers with proper error handling.
 * Fixes bug #3: lib/settings.js didn't handle chrome.runtime.lastError,
 * causing undefined responses and 0ms rapid-fire clicks.
 */

import { DEFAULT_SETTINGS } from './constants.js';

// Bug 12: chrome.storage.local has a 10MB quota. We surface a warning entry
// when usage exceeds 80% so the UI can show a banner. Use a sentinel storage
// key 'meta.quota' rather than adding it to STORAGE_KEYS — keeping that change
// out of constants.js since it lives in another agent's scope this round.
const QUOTA_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB chrome.storage.local
const QUOTA_WARN_THRESHOLD = 0.8;
const QUOTA_CHECK_INTERVAL_MS = 60 * 1000; // throttle: at most once per 60s
let _lastQuotaCheck = 0;

function checkQuotaWarning() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local?.getBytesInUse) return;
  try {
    chrome.storage.local.getBytesInUse(null, (bytes) => {
      if (chrome.runtime && chrome.runtime.lastError) return;
      const ratio = bytes / QUOTA_LIMIT_BYTES;
      if (ratio > QUOTA_WARN_THRESHOLD) {
        try {
          chrome.storage.local.set({
            'meta.quota': {
              ratio,
              bytes,
              limit: QUOTA_LIMIT_BYTES,
              lastChecked: new Date().toISOString()
            }
          });
        } catch {}
      }
    });
  } catch {}
}

function maybeCheckQuota() {
  const now = Date.now();
  if (now - _lastQuotaCheck < QUOTA_CHECK_INTERVAL_MS) return;
  _lastQuotaCheck = now;
  checkQuotaWarning();
}

/**
 * Get current storage usage stats. Returns { bytes, limit, ratio } or null
 * if chrome.storage.local.getBytesInUse is unavailable.
 * @returns {Promise<{bytes:number, limit:number, ratio:number}|null>}
 */
export function getStorageStats() {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.getBytesInUse) {
      resolve(null);
      return;
    }
    try {
      chrome.storage.local.getBytesInUse(null, (bytes) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve({
          bytes,
          limit: QUOTA_LIMIT_BYTES,
          ratio: bytes / QUOTA_LIMIT_BYTES
        });
      });
    } catch {
      resolve(null);
    }
  });
}

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
        // Bug 12: throttled quota check after each successful set
        maybeCheckQuota();
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
