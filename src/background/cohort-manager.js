/**
 * CohortManager — syncs shared accelerator cohort data and provides
 * leaderboard, content calendar, warm intro detection, and shared templates.
 *
 * Data source: a JSON URL configured by the accelerator (GitHub raw, API, etc.)
 * Falls back to local cohort config from options page.
 *
 * Cohort JSON schema:
 * {
 *   cohort: "Techstars NYC W26",
 *   members: [{ name, linkedin, company }],
 *   contentCalendar: { monday: ["slug1"], tuesday: ["slug2"], ... },
 *   sharedTemplates: [{ name, text, replyRate, category }],
 *   leaderboard: { postsThisWeek: {}, connectionsGrown: {}, replyRate: {} },
 *   updatedAt: ISO
 * }
 */

import { STORAGE_KEYS } from '../shared/constants.js';

const COHORT_SYNC_ALARM = 'cohort-sync';
const SYNC_INTERVAL_MINUTES = 60; // Hourly
let syncInProgress = false; // Guard against concurrent syncs

/**
 * Bug 23: Normalize cohort.members so consumers always see
 * [{name, linkedin, company}]. Members may arrive as bare strings (legacy),
 * partial objects, or already-normalized objects.
 *
 * Bug 20: do NOT drop entries that lack a LinkedIn URL. Cohorts often
 * include members who haven't shared their LinkedIn yet (or don't have a
 * public profile), and dropping them here removed them from leaderboards,
 * member counts, and content calendars — surprising behavior. Downstream
 * consumers that genuinely require a LinkedIn URL (e.g. detectWarmIntros)
 * filter per-iteration themselves.
 * @param {any} members
 * @returns {Array<{name:string, linkedin:string, company:string}>}
 */
function normalizeMembers(members) {
  if (!Array.isArray(members)) return [];
  return members.map(m => {
    if (typeof m === 'string') return { name: '', linkedin: m, company: '' };
    if (!m || typeof m !== 'object') return { name: '', linkedin: '', company: '' };
    return {
      name: m.name || '',
      linkedin: m.linkedin || '',
      company: m.company || ''
    };
  });
  // Bug 20: no .filter — keep entries even without a LinkedIn URL.
}

/**
 * Validate that a URL is a safe HTTPS endpoint.
 * Prevents exfiltration via protocol-relative or non-HTTPS URLs.
 * @param {string} url
 * @returns {boolean}
 */
function isValidSyncUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Initialize the cohort manager.
 */
export function initCohortManager() {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === COHORT_SYNC_ALARM) {
      await syncCohortData();
    }
  });

  chrome.alarms.create(COHORT_SYNC_ALARM, { periodInMinutes: SYNC_INTERVAL_MINUTES });

  // Sync on startup
  syncCohortData();
}

/**
 * Sync cohort data from remote URL if configured.
 */
export async function syncCohortData() {
  if (syncInProgress) return;
  syncInProgress = true;
  try {
    await _doSync();
  } finally {
    syncInProgress = false;
  }
}

async function _doSync() {
  const config = await getCohortConfig();
  if (!config.syncUrl) return;

  if (!isValidSyncUrl(config.syncUrl)) {
    console.warn('Cohort sync: rejecting non-HTTPS syncUrl');
    await saveCohortConfig({ ...config, syncError: 'syncUrl must be HTTPS' });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(config.syncUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      await saveCohortConfig({ ...config, syncError: `HTTP ${response.status}` });
      return;
    }

    const remote = await response.json();

    // Bug 26: validate shape of remote fields before merging. A malformed
    // upstream JSON (e.g. `connectionMap: "oops"` or an array) would otherwise
    // poison local storage and crash later consumers. We drop bad fields
    // gracefully rather than aborting the whole sync.
    if (
      remote.connectionMap !== undefined &&
      (typeof remote.connectionMap !== 'object' ||
        Array.isArray(remote.connectionMap) ||
        remote.connectionMap === null)
    ) {
      console.warn('Cohort sync: rejecting malformed connectionMap');
      delete remote.connectionMap;
    }
    if (remote.members !== undefined && !Array.isArray(remote.members)) {
      console.warn('Cohort sync: rejecting malformed members (expected array)');
      delete remote.members;
    }
    if (
      remote.sharedTemplates !== undefined &&
      !Array.isArray(remote.sharedTemplates)
    ) {
      console.warn('Cohort sync: rejecting malformed sharedTemplates (expected array)');
      delete remote.sharedTemplates;
    }
    if (
      remote.leaderboard !== undefined &&
      (typeof remote.leaderboard !== 'object' ||
        Array.isArray(remote.leaderboard) ||
        remote.leaderboard === null)
    ) {
      console.warn('Cohort sync: rejecting malformed leaderboard');
      delete remote.leaderboard;
    }
    if (
      remote.contentCalendar !== undefined &&
      (typeof remote.contentCalendar !== 'object' ||
        Array.isArray(remote.contentCalendar) ||
        remote.contentCalendar === null)
    ) {
      console.warn('Cohort sync: rejecting malformed contentCalendar');
      delete remote.contentCalendar;
    }

    // Merge remote into local — remote is authoritative for shared fields.
    // Bug 23: normalize members so the merged shape is always
    // [{name, linkedin, company}] regardless of what the remote sent.
    // Bug 25: drop null-slug keys from connectionMap so '' never accumulates
    // false-positive warm-intro matches.
    const rawConnectionMap = remote.connectionMap || config.connectionMap || {};
    const cleanConnectionMap = Object.fromEntries(
      Object.entries(rawConnectionMap).filter(([key]) => key !== null && key !== '')
    );
    const merged = {
      ...config,
      ...remote,
      members: normalizeMembers(remote.members || config.members || []),
      connectionMap: cleanConnectionMap,
      syncUrl: config.syncUrl, // Preserve local syncUrl
      syncError: null,
      lastSynced: new Date().toISOString()
    };

    await saveCohortConfig(merged);
  } catch (err) {
    console.warn('Cohort sync failed:', err.message);
    await saveCohortConfig({ ...config, syncError: err.message });
  }
}

/**
 * Get the full cohort config.
 * Bug 23: members is normalized on read so consumers always see
 * [{name, linkedin, company}].
 * @returns {Promise<Object>}
 */
export function getCohortConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEYS.COHORT, (result) => {
      const cfg = result[STORAGE_KEYS.COHORT] || { members: [] };
      cfg.members = normalizeMembers(cfg.members);
      resolve(cfg);
    });
  });
}

/**
 * Save cohort config. Bug 23: normalize members before write so the stored
 * shape is consistent regardless of caller.
 * @param {Object} config
 */
export function saveCohortConfig(config) {
  const normalized = {
    ...config,
    members: normalizeMembers(config && config.members)
  };
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEYS.COHORT]: normalized }, resolve);
  });
}

/**
 * Get the leaderboard from cohort data.
 * @returns {Promise<Object>}
 */
export async function getLeaderboard() {
  const config = await getCohortConfig();
  return config.leaderboard || {};
}

/**
 * Get today's content calendar slot.
 * @returns {Promise<{isYourDay: boolean, todayPosters: string[], dayName: string}>}
 */
export async function getContentCalendar() {
  const config = await getCohortConfig();
  const calendar = config.contentCalendar || {};
  const mySlug = config.mySlug || '';

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = days[new Date().getDay()];
  const todayPosters = calendar[dayName] || [];

  return {
    dayName,
    todayPosters,
    isYourDay: todayPosters.includes(mySlug),
    calendar
  };
}

/**
 * Get shared templates from cohort data.
 * @returns {Promise<Object[]>}
 */
export async function getSharedTemplates() {
  const config = await getCohortConfig();
  return config.sharedTemplates || [];
}

/**
 * Detect warm intros — find cohort members who are connected to a target.
 * Compares a target profile URL against the stored connections of each cohort member.
 *
 * @param {string} targetProfileUrl - LinkedIn profile URL of the person you want to reach
 * @returns {Promise<Object[]>} Array of { memberName, memberLinkedin, memberCompany }
 */
export async function detectWarmIntros(targetProfileUrl) {
  const config = await getCohortConfig();
  const members = config.members || [];
  const connectionMap = config.connectionMap || {};

  // connectionMap is { memberSlug: [profileUrl1, profileUrl2, ...] }
  // Populated by each member running extract-contacts and uploading via the sync endpoint

  const normalizedTarget = normalizeProfileUrl(targetProfileUrl);
  // Bug 25: if target URL is unparseable we can't match anything — bail early.
  if (!normalizedTarget) return [];
  const matches = [];

  for (const member of members) {
    // Bug 20: members without a LinkedIn URL are kept by normalizeMembers,
    // so consumers that need a slug must filter per-iteration. Without this
    // guard extractSlug('') would return null (Bug 25 fix) but we still skip
    // early to avoid the connectionMap lookup.
    if (!member.linkedin) continue;
    const memberSlug = extractSlug(member.linkedin);
    // Bug 25: skip members whose LinkedIn URL doesn't contain /in/slug
    if (!memberSlug) continue;
    const memberConnections = connectionMap[memberSlug] || [];

    if (memberConnections.some(url => normalizeProfileUrl(url) === normalizedTarget)) {
      matches.push({
        memberName: member.name,
        memberLinkedin: member.linkedin,
        memberCompany: member.company || ''
      });
    }
  }

  return matches;
}

/**
 * Upload my connections to the cohort sync (for warm intro detection).
 * This sends my connection list to the sync endpoint so other members can detect intros.
 * @returns {Promise<boolean>}
 */
export async function uploadMyConnections() {
  const config = await getCohortConfig();
  if (!config.syncUrl || !config.mySlug) return false;

  // Get my stored contacts
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEYS.DATA_CONTACTS, async (result) => {
      const contacts = result[STORAGE_KEYS.DATA_CONTACTS] || {};
      // Bug 25: filter out URLs that don't resolve to a valid /in/slug — null
      // slugs would create an empty-string bucket in the server's connectionMap.
      const profileUrls = Object.keys(contacts.items || {}).filter(
        url => extractSlug(url) !== null
      );

      if (profileUrls.length === 0) {
        resolve(false);
        return;
      }

      // POST to sync endpoint
      if (!isValidSyncUrl(config.syncUrl)) {
        console.warn('Cohort upload: rejecting non-HTTPS syncUrl');
        resolve(false);
        return;
      }
      const uploadUrl = config.syncUrl.replace(/\.json$/, '') + '/connections';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            member: config.mySlug,
            connections: profileUrls
          }),
          signal: controller.signal
        });
        resolve(true);
      } catch {
        resolve(false);
      } finally {
        clearTimeout(timer);
      }
    });
  });
}

// --- Helpers ---

function normalizeProfileUrl(url) {
  // Bug 25: return null instead of '' for missing/unparseable input so callers
  // can distinguish "no URL" from a valid slug match.
  if (!url) return null;
  // Extract /in/slug/ part and normalize
  const match = url.match(/\/in\/([^/?]+)/);
  return match ? match[1].toLowerCase() : null;
}

function extractSlug(url) {
  // Bug 25: return null instead of '' so the empty-string key never appears
  // in connectionMap, preventing false positive warm-intro matches.
  if (!url) return null;
  const match = url.match(/\/in\/([^/?]+)/);
  return match ? match[1] : null;
}
