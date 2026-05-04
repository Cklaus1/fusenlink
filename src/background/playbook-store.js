/**
 * PlaybookStore — CRUD for playbooks and selector registries in chrome.storage.local.
 */

import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../shared/constants.js';
import { DEFAULT_PLAYBOOKS } from '../defaults/playbooks.js';
import { DEFAULT_SELECTOR_REGISTRIES } from '../defaults/selectors.js';
import { validatePlaybook } from '../shared/playbook-validator.js';

// Simple mutex to serialize read-modify-write storage operations.
// Always resolves lockChain even on error so future operations aren't blocked.
const locks = {};
function withLock(key, fn) {
  const prev = locks[key] || Promise.resolve();
  const next = prev.then(fn, fn).catch((err) => {
    // Re-throw so the caller gets the error, but reset the chain to a resolved
    // state so subsequent operations aren't blocked by a rejected promise.
    locks[key] = Promise.resolve();
    throw err;
  });
  locks[key] = next.then(() => {}, () => {});
  return next;
}

/**
 * Initialize storage with defaults on first install or version upgrade.
 * Also migrates v1 settings from chrome.storage.sync to chrome.storage.local.
 * Bug 31: After first-install seed, walk DEFAULT_PLAYBOOKS and
 * DEFAULT_SELECTOR_REGISTRIES and replace stored entries whose shipped
 * version exceeds the stored version. User-modified custom playbooks
 * (IDs not in DEFAULT_PLAYBOOKS) are preserved.
 */
export async function initializeDefaults() {
  // Migrate v1 settings from sync → local (v1 used chrome.storage.sync)
  await migrateV1Settings();

  await new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.PLAYBOOKS, STORAGE_KEYS.SELECTORS, STORAGE_KEYS.SETTINGS], (result) => {
      const updates = {};

      if (!result[STORAGE_KEYS.PLAYBOOKS]) {
        updates[STORAGE_KEYS.PLAYBOOKS] = DEFAULT_PLAYBOOKS;
      }

      if (!result[STORAGE_KEYS.SELECTORS]) {
        updates[STORAGE_KEYS.SELECTORS] = DEFAULT_SELECTOR_REGISTRIES;
      }

      if (!result[STORAGE_KEYS.SETTINGS]) {
        updates[STORAGE_KEYS.SETTINGS] = DEFAULT_SETTINGS;
      }

      if (Object.keys(updates).length > 0) {
        chrome.storage.local.set(updates, () => resolve());
      } else {
        resolve();
      }
    });
  });

  // Bug 31: version-aware migrations on every startup. These are no-ops
  // when nothing changed; otherwise they replace stored defaults whose
  // shipped version has bumped. Bug 33: each migration appends a record
  // to meta.migrations.
  const playbookChanges = await migrateDefaults();
  const selectorChanges = await migrateSelectors();
  if (playbookChanges.length > 0 || selectorChanges.length > 0) {
    await recordMigration({
      playbooks: playbookChanges,
      selectors: selectorChanges
    });
  }
}

/**
 * Bug 31: Replace stored playbook defaults when shipped version is newer.
 * Returns list of migrated IDs (with new version) for migration log.
 */
async function migrateDefaults() {
  return withLock(STORAGE_KEYS.PLAYBOOKS, async () => {
    const stored = await getAllPlaybooks();
    const changed = [];
    for (const [id, shipped] of Object.entries(DEFAULT_PLAYBOOKS)) {
      const existing = stored[id];
      if (!existing || (shipped.version || 0) > (existing.version || 0)) {
        stored[id] = shipped;
        changed.push(`${id}:v${shipped.version || 0}`);
      }
    }
    if (changed.length > 0) {
      await new Promise(r => chrome.storage.local.set({ [STORAGE_KEYS.PLAYBOOKS]: stored }, r));
    }
    return changed;
  });
}

/**
 * Bug 31: Replace stored selector registries when shipped version is newer.
 * Returns list of migrated registry keys for migration log.
 */
async function migrateSelectors() {
  return withLock(STORAGE_KEYS.SELECTORS, async () => {
    const stored = await new Promise(r => chrome.storage.local.get(STORAGE_KEYS.SELECTORS, x => r(x[STORAGE_KEYS.SELECTORS] || {})));
    const changed = [];
    for (const [key, shipped] of Object.entries(DEFAULT_SELECTOR_REGISTRIES)) {
      const existing = stored[key];
      if (!existing || (shipped.version || 0) > (existing.version || 0)) {
        stored[key] = shipped;
        changed.push(`${key}:v${shipped.version || 0}`);
      }
    }
    if (changed.length > 0) {
      await new Promise(r => chrome.storage.local.set({ [STORAGE_KEYS.SELECTORS]: stored }, r));
    }
    return changed;
  });
}

/**
 * Bug 33: append a migration record to meta.migrations. Append-only,
 * capped at the last 10 entries so the meta blob can't grow unbounded.
 */
async function recordMigration(changes) {
  return withLock('meta.migrations', async () => {
    const stored = await new Promise(r => chrome.storage.local.get('meta.migrations', x => r(x['meta.migrations'] || [])));
    const history = Array.isArray(stored) ? stored : [];
    history.push({
      version: chrome.runtime?.getManifest?.()?.version || 'unknown',
      migratedAt: new Date().toISOString(),
      changes
    });
    // Cap at last 10
    const capped = history.slice(-10);
    await new Promise(r => chrome.storage.local.set({ 'meta.migrations': capped }, r));
  });
}

/**
 * Migrate v1 settings from chrome.storage.sync to chrome.storage.local.
 * v1 stored {maxInvites, delayMs} in sync. v2 uses local.
 * Only runs once — clears sync after migration.
 */
async function migrateV1Settings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['maxInvites', 'delayMs'], (syncResult) => {
      if (chrome.runtime.lastError || !syncResult.maxInvites) {
        resolve(); // Nothing to migrate
        return;
      }

      // Merge into local (don't overwrite if local already has settings)
      chrome.storage.local.get(STORAGE_KEYS.SETTINGS, (localResult) => {
        const existing = localResult[STORAGE_KEYS.SETTINGS];
        if (existing && existing.maxInvites !== DEFAULT_SETTINGS.maxInvites) {
          resolve(); // Local already has non-default settings, skip
          return;
        }

        const migrated = {
          ...DEFAULT_SETTINGS,
          maxInvites: syncResult.maxInvites || DEFAULT_SETTINGS.maxInvites,
          delayMs: syncResult.delayMs || DEFAULT_SETTINGS.delayMs
        };

        chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: migrated }, () => {
          // Clean up sync storage
          chrome.storage.sync.remove(['maxInvites', 'delayMs'], () => {
            console.log('Migrated v1 settings from sync to local:', migrated);
            resolve();
          });
        });
      });
    });
  });
}

/**
 * Get all playbooks.
 * @returns {Promise<Object>}
 */
export function getAllPlaybooks() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS.PLAYBOOKS, (result) => {
      resolve(result[STORAGE_KEYS.PLAYBOOKS] || DEFAULT_PLAYBOOKS);
    });
  });
}

/**
 * Get a single playbook by ID.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getPlaybook(id) {
  const playbooks = await getAllPlaybooks();
  return playbooks[id] || null;
}

/**
 * Save a playbook.
 * @param {Object} playbook
 * @returns {Promise<void>}
 */
export async function savePlaybook(playbook) {
  // Validate before saving
  const { valid, errors } = validatePlaybook(playbook);
  if (!valid) {
    throw new Error(`Invalid playbook: ${errors.join('; ')}`);
  }

  return withLock(STORAGE_KEYS.PLAYBOOKS, async () => {
    const playbooks = await getAllPlaybooks();
    playbooks[playbook.id] = playbook;
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEYS.PLAYBOOKS]: playbooks }, resolve);
    });
  });
}

/**
 * Delete a playbook by ID.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deletePlaybook(id) {
  return withLock(STORAGE_KEYS.PLAYBOOKS, async () => {
    const playbooks = await getAllPlaybooks();
    delete playbooks[id];
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEYS.PLAYBOOKS]: playbooks }, resolve);
    });
  });
}

/**
 * Get a selector registry by key.
 * @param {string} key - e.g. 'linkedin.invitations'
 * @returns {Promise<Object>}
 */
export function getSelectors(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS.SELECTORS, (result) => {
      const registries = result[STORAGE_KEYS.SELECTORS] || DEFAULT_SELECTOR_REGISTRIES;
      resolve(registries[key] || {});
    });
  });
}

/**
 * Save a selector registry.
 * @param {string} key
 * @param {Object} registry
 * @returns {Promise<void>}
 */
export async function saveSelectors(key, registry) {
  return withLock(STORAGE_KEYS.SELECTORS, async () => {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEYS.SELECTORS, (result) => {
        const registries = result[STORAGE_KEYS.SELECTORS] || {};
        registries[key] = registry;
        chrome.storage.local.set({ [STORAGE_KEYS.SELECTORS]: registries }, resolve);
      });
    });
  });
}

/**
 * Get settings with defaults.
 * @returns {Promise<Object>}
 */
export function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS.SETTINGS, (result) => {
      resolve({
        ...DEFAULT_SETTINGS,
        ...(result[STORAGE_KEYS.SETTINGS] || {})
      });
    });
  });
}

/**
 * Save settings.
 * @param {Object} settings
 * @returns {Promise<void>}
 */
export function saveSettings(settings) {
  return withLock(STORAGE_KEYS.SETTINGS, async () => {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEYS.SETTINGS, (result) => {
        const merged = { ...(result[STORAGE_KEYS.SETTINGS] || {}), ...settings };
        chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged }, resolve);
      });
    });
  });
}
