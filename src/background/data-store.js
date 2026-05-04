/**
 * DataStore — structured data CRUD for extracted LinkedIn data.
 * Manages contacts, inbox analyses, outreach, profile reviews, and activity logs.
 */

import { STORAGE_KEYS } from '../shared/constants.js';
import { withLock } from '../shared/lock.js';

/**
 * Store data into a collection.
 * @param {string} collection - Collection name (e.g., 'contacts', 'inbox')
 * @param {Object|Array} data - Data to store
 * @param {Object} [options]
 * @param {string} [options.mergeKey] - Field to use for dedup (upsert by this key)
 * @returns {Promise<{success: boolean, count: number}>}
 */
export async function storeData(collection, data, options = {}) {
  const storageKey = getStorageKey(collection);
  if (!storageKey) return { success: false, count: 0, error: 'Unknown collection' };

  return withLock(storageKey, async () => {
    const existing = await get(storageKey);

    if (options.mergeKey && Array.isArray(data)) {
      // Merge by key — upsert items, track skipped items missing the merge field
      const items = existing.items || {};
      let stored = 0;
      let skipped = 0;
      for (const item of data) {
        const key = item[options.mergeKey];
        if (key) {
          items[key] = { ...items[key], ...item, updatedAt: new Date().toISOString() };
          stored++;
        } else {
          skipped++;
        }
      }
      existing.items = items;
      existing.updatedAt = new Date().toISOString();
      await set(storageKey, existing);
      return { success: true, count: stored, skipped };
    }

    if (Array.isArray(data)) {
      // Append to entries array
      existing.entries = existing.entries || [];
      const timestamped = data.map(item => ({
        ...item,
        timestamp: item.timestamp || new Date().toISOString()
      }));
      existing.entries = existing.entries.concat(timestamped);
      existing.updatedAt = new Date().toISOString();
      await set(storageKey, existing);
      return { success: true, count: data.length, skipped: 0 };
    }

    // Single object — store directly
    existing.data = data;
    existing.updatedAt = new Date().toISOString();
    await set(storageKey, existing);
    return { success: true, count: 1, skipped: 0 };
  });
}

/**
 * Get data from a collection.
 * @param {string} collection - Collection name
 * @param {Object} [options]
 * @param {number} [options.limit] - Max items to return
 * @param {string} [options.format] - 'json' (default) or 'csv'
 * @returns {Promise<Object>}
 */
export async function getData(collection, options = {}) {
  const storageKey = getStorageKey(collection);
  if (!storageKey) return { error: 'Unknown collection' };

  const stored = await get(storageKey);
  // Only deep clone when we need to mutate (limit/format), otherwise return directly
  const needsClone = options.limit || options.format === 'csv';
  let data;
  if (needsClone) {
    try {
      data = JSON.parse(JSON.stringify(stored));
    } catch (err) {
      console.warn('getData: clone failed, returning raw data', err.message);
      data = stored;
    }
  } else {
    data = stored;
  }

  if (options.limit) {
    if (data.items) {
      const entries = Object.entries(data.items).slice(0, options.limit);
      data.items = Object.fromEntries(entries);
    }
    if (data.entries) {
      data.entries = data.entries.slice(-options.limit);
    }
  }

  if (options.format === 'csv' && data.items) {
    data.csv = itemsToCsv(Object.values(data.items));
  }

  // Strip internal write counter from response. Use destructure so we never
  // mutate a live storage cache reference (data may be unrcloned above).
  if (data && typeof data === 'object') {
    const { _writeCount, ...rest } = data;
    return rest;
  }

  return data;
}

/**
 * Delete a collection's data.
 * @param {string} collection
 * @returns {Promise<{success: boolean}>}
 */
export async function deleteData(collection) {
  const storageKey = getStorageKey(collection);
  if (!storageKey) return { success: false };

  return new Promise((resolve) => {
    chrome.storage.local.remove(storageKey, () => {
      resolve({ success: true });
    });
  });
}

/**
 * Log an activity entry.
 * @param {Object} entry - { playbookId, action, target, details, outcome }
 * @returns {Promise<void>}
 */
export async function logActivity(entry) {
  return withLock(STORAGE_KEYS.DATA_ACTIVITY_LOG, async () => {
    const data = await get(STORAGE_KEYS.DATA_ACTIVITY_LOG);
    data.entries = data.entries || [];
    data._writeCount = (data._writeCount || 0) + 1;
    data.entries.push({
      id: generateId(),
      timestamp: new Date().toISOString(),
      ...entry
    });

    // Prune lazily: every 50th write OR when entries balloon past 1100
    if (data._writeCount % 50 === 0 || data.entries.length > 1100) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      data.entries = data.entries.filter(e => !e.timestamp || e.timestamp >= thirtyDaysAgo);
      if (data.entries.length > 1000) {
        data.entries = data.entries.slice(-1000);
      }
    }

    await set(STORAGE_KEYS.DATA_ACTIVITY_LOG, data);
  });
}

// --- Helpers ---

function getStorageKey(collection) {
  const map = {
    contacts: STORAGE_KEYS.DATA_CONTACTS,
    inbox: STORAGE_KEYS.DATA_INBOX,
    outreach: STORAGE_KEYS.DATA_OUTREACH,
    profileReviews: STORAGE_KEYS.DATA_PROFILE_REVIEWS,
    activityLog: STORAGE_KEYS.DATA_ACTIVITY_LOG
  };
  return map[collection] || null;
}

function get(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve(result[key] || {});
    });
  });
}

function set(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function itemsToCsv(items) {
  // Filter out null/undefined items and bail if empty
  const valid = items.filter(i => i != null && typeof i === 'object');
  if (valid.length === 0) return '';
  // Bug 29: build the header from the union of all rows' keys instead of
  // just the first row. Schema drift between writes used to silently drop
  // columns introduced in later items.
  const headerSet = new Set();
  for (const item of valid) {
    for (const k of Object.keys(item)) headerSet.add(k);
  }
  const headers = Array.from(headerSet);
  const rows = valid.map(item =>
    headers.map(h => `"${String(item[h] ?? '').replace(/"/g, '""')}"`).join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}
