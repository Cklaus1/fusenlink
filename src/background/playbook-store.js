/**
 * PlaybookStore — CRUD for playbooks and selector registries in chrome.storage.local.
 */

import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../shared/constants.js';
import { DEFAULT_PLAYBOOKS } from '../defaults/playbooks.js';
import { DEFAULT_SELECTOR_REGISTRIES } from '../defaults/selectors.js';
import { validatePlaybook, validateSelectorRegistry } from '../shared/playbook-validator.js';

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
 * Bug 35: Validate every shipped default before seeding. Returns map of
 * id -> error string for any that fail. Used to (a) yell loudly in CI
 * and (b) skip the bad ones at write time so a single broken default
 * can't brick the whole install.
 */
function assertDefaultsValid() {
  const errors = {};
  for (const [id, pb] of Object.entries(DEFAULT_PLAYBOOKS)) {
    const { valid, errors: pbErrors } = validatePlaybook(pb);
    if (!valid) errors[id] = pbErrors.join('; ');
  }
  return errors;
}

/**
 * Initialize storage with defaults on first install or version upgrade.
 * Also migrates v1 settings from chrome.storage.sync to chrome.storage.local.
 * Bug 31: After first-install seed, walk DEFAULT_PLAYBOOKS and
 * DEFAULT_SELECTOR_REGISTRIES and replace stored entries whose shipped
 * version exceeds the stored version. User-modified custom playbooks
 * (IDs not in DEFAULT_PLAYBOOKS) are preserved.
 * Bug 35: validate shipped defaults before seeding; skip any invalid ids
 * but don't crash the install.
 */
export async function initializeDefaults() {
  // Bug 35: validate shipped defaults. Log loudly so CI/devs notice; on
  // user machines we still continue and skip the bad ones below.
  const invalidDefaults = assertDefaultsValid();
  const invalidIds = Object.keys(invalidDefaults);
  if (invalidIds.length > 0) {
    console.error(
      'FusenLink: ship defaults failed validation:',
      invalidIds.map(id => `${id}: ${invalidDefaults[id]}`)
    );
  }

  // Migrate v1 settings from sync → local (v1 used chrome.storage.sync)
  await migrateV1Settings();

  await new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.PLAYBOOKS, STORAGE_KEYS.SELECTORS, STORAGE_KEYS.SETTINGS], (result) => {
      const updates = {};

      if (!result[STORAGE_KEYS.PLAYBOOKS]) {
        // Bug 35: drop any invalid defaults at seed time.
        const seedPlaybooks = {};
        for (const [id, pb] of Object.entries(DEFAULT_PLAYBOOKS)) {
          if (!invalidDefaults[id]) seedPlaybooks[id] = pb;
        }
        updates[STORAGE_KEYS.PLAYBOOKS] = seedPlaybooks;
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
  // to meta.migrations. Bug 6: dropped settings keys (e.g. user's tweak
  // to a renamed key) flow through to the migration log.
  const { changed: playbookChanges, droppedByPlaybook } = await migrateDefaults(invalidDefaults);
  const selectorChanges = await migrateSelectors();
  if (playbookChanges.length > 0 || selectorChanges.length > 0) {
    const entry = {
      playbooks: playbookChanges,
      selectors: selectorChanges
    };
    if (droppedByPlaybook && Object.keys(droppedByPlaybook).length > 0) {
      entry.droppedSettings = droppedByPlaybook;
    }
    await recordMigration(entry);
  }
}

/**
 * Bug 2 / Bug 4: Per-field merge between shipped and stored playbook on
 * version bump.
 *
 * `settings` is fully merged: start from shipped defaults, overlay stored
 * values for keys still present in shipped, capture removed/renamed keys
 * in `droppedSettings` (Bug 6).
 *
 * Top-level fields the user is allowed to customize from the options UI
 * (`urlPattern`, `buttonLabel`, `description`) are PROTECTED — if the
 * stored value differs from the shipped value, we assume the user
 * customized it and keep the stored value.
 *
 * Trade-off (Bug 2): we cannot tell which prior shipped default produced
 * the stored value, so any time the shipped default for one of these
 * fields changes between versions, users who never customized will keep
 * the OLD shipped default. The options UI should expose an explicit
 * "Reset to defaults" affordance for users who want fresh ship behavior.
 *
 * Other ship-controlled fields (`steps`, `selectors` registry key,
 * `version`, `name`) continue to be REPLACED with shipped values.
 *
 * Note on `selectors`: this is the registry KEY (e.g.
 * 'linkedin.invitations'), not the selector data itself. Selector data
 * lives in DEFAULT_SELECTOR_REGISTRIES and is ship-controlled.
 */
function mergePlaybookFields(shipped, stored) {
  const mergedSettings = {};
  const droppedSettings = {};
  // start with shipped defaults
  for (const k of Object.keys(shipped.settings || {})) {
    mergedSettings[k] = shipped.settings[k];
  }
  // overlay user customizations (only for keys still present in shipped);
  // capture any stored keys that no longer exist in shipped so the
  // migration log can surface them (Bug 6).
  for (const k of Object.keys(stored.settings || {})) {
    if (k in (shipped.settings || {})) {
      mergedSettings[k] = stored.settings[k];
    } else {
      droppedSettings[k] = stored.settings[k];
    }
  }

  // Bug 2: preserve user-customizable top-level fields when stored differs
  // from shipped. We can't tell what the *prior* shipped default was, so
  // "stored !== shipped" is a heuristic for "user customized". See the
  // trade-off note above.
  const PROTECTED_FIELDS = ['urlPattern', 'buttonLabel', 'description'];
  const merged = {
    ...shipped, // steps, name, selectors, version, urlPattern/buttonLabel/description (overwritten below if user-customized)
    settings: mergedSettings
  };
  for (const field of PROTECTED_FIELDS) {
    if (stored[field] !== undefined && stored[field] !== shipped[field]) {
      merged[field] = stored[field];
    }
  }

  return { merged, droppedSettings };
}

// Exported for tests.
export { mergePlaybookFields };

/**
 * Bug 31: Replace stored playbook defaults when shipped version is newer.
 * Bug 4: Per-field merge — preserve user `settings` customizations,
 * replace ship-controlled fields. Bug 35: skip ids whose shipped default
 * failed validation.
 * Returns list of migrated IDs (with new version) for migration log.
 * @param {Object} [invalidDefaults] - map of id -> error string for ids to skip
 */
async function migrateDefaults(invalidDefaults = {}) {
  return withLock(STORAGE_KEYS.PLAYBOOKS, async () => {
    const stored = await getAllPlaybooks();
    const changed = [];
    const droppedByPlaybook = {};
    for (const [id, shipped] of Object.entries(DEFAULT_PLAYBOOKS)) {
      if (invalidDefaults[id]) continue; // Bug 35: don't write a known-broken default
      // Bug 30: never write a default that itself fails validation, even if
      // CI didn't pre-flag it.
      const { valid: shippedValid, errors: shippedErrors } = validatePlaybook(shipped);
      if (!shippedValid) {
        console.error(`Migration: skipping invalid default ${id}:`, shippedErrors);
        continue;
      }
      const existing = stored[id];
      if (!existing) {
        stored[id] = shipped;
        changed.push(`${id}:v${shipped.version || 0}`);
      } else if ((shipped.version || 0) > (existing.version || 0)) {
        // Bug 4: merge instead of overwrite, preserving user settings tweaks.
        // Bug 6: capture any dropped (renamed/removed) settings keys so we
        // can surface them in the migration log.
        const { merged, droppedSettings } = mergePlaybookFields(shipped, existing);
        stored[id] = merged;
        changed.push(`${id}:v${shipped.version || 0}`);
        if (Object.keys(droppedSettings).length > 0) {
          droppedByPlaybook[id] = droppedSettings;
        }
      }
    }
    if (changed.length > 0) {
      await new Promise(r => chrome.storage.local.set({ [STORAGE_KEYS.PLAYBOOKS]: stored }, r));
    }
    return { changed, droppedByPlaybook };
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
      // Bug 30: don't write a default registry that itself fails validation.
      const { valid, errors } = validateSelectorRegistry(shipped);
      if (!valid) {
        console.error(`Migration: skipping invalid selector registry ${key}:`, errors);
        continue;
      }
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
 * Bug 22 / Bug 33: append a migration record to meta.migrations.
 * Append-only, capped at the last 50 entries so the meta blob can't grow
 * unbounded. When entries exceed the cap, the meta record (re-)written
 * carries a `truncated: true` flag so the UI can show "earlier history
 * truncated".
 */
const MIGRATION_LOG_CAP = 50;

async function recordMigration(changes) {
  return withLock('meta.migrations', async () => {
    const stored = await new Promise(r => chrome.storage.local.get('meta.migrations', x => r(x['meta.migrations'])));
    // Support both legacy shape (array) and new shape ({ entries, truncated }).
    let entries = [];
    let prevTruncated = false;
    if (Array.isArray(stored)) {
      entries = stored.slice();
    } else if (stored && Array.isArray(stored.entries)) {
      entries = stored.entries.slice();
      prevTruncated = !!stored.truncated;
    }
    entries.push({
      version: chrome.runtime?.getManifest?.()?.version || 'unknown',
      migratedAt: new Date().toISOString(),
      changes
    });
    // Bug 22: cap at last 50 (was 10) and flag truncation for the UI.
    let truncated = prevTruncated;
    if (entries.length > MIGRATION_LOG_CAP) {
      entries = entries.slice(-MIGRATION_LOG_CAP);
      truncated = true;
    }
    await new Promise(r => chrome.storage.local.set({ 'meta.migrations': { entries, truncated } }, r));
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
