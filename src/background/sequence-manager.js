/**
 * SequenceManager — multi-step outreach campaign engine.
 *
 * A sequence is a campaign with ordered message steps and delays.
 * Each enrolled contact progresses through the steps independently.
 * The manager checks periodically (via chrome.alarms) who needs their next message.
 *
 * Data model in chrome.storage.local under 'data.sequences':
 * {
 *   items: {
 *     [sequenceId]: {
 *       id, name, steps: [{ delayDays, template, aiType? }],
 *       settings: { staggerMinutes, quietHoursStart, quietHoursEnd },
 *       contacts: { [profileUrl]: { name, currentStep, status, lastMessageAt, nextMessageAt, messages[] } },
 *       stats: { enrolled, sent, replied, completed },
 *       createdAt, updatedAt
 *     }
 *   }
 * }
 */

/**
 * Sequence settings schema:
 * {
 *   staggerMinutes: number,       // default 1; minutes between consecutive enrolled contacts' first sends
 *   quietHoursStart: number,      // default 8; hour-of-day in `timezone` when sending is allowed
 *   quietHoursEnd: number,        // default 20; hour-of-day when sending stops
 *   timezone: string,             // default 'UTC'; IANA timezone for quiet hours
 *   weekdaysOnly: boolean,        // default false (true for new sequences); skip Sat/Sun
 *   delayMs: number,              // default 1500; ms between actions during a single send batch
 *   securityCheckEnabled: boolean,// default true; pause for CAPTCHA detection
 *   securityCheckInterval: number // default 5; check every N sends
 * }
 */

import { STORAGE_KEYS } from '../shared/constants.js';
import { MSG } from '../shared/messages.js';
import * as AI from './ai-client.js';

const SEQUENCE_ALARM = 'sequence-check';
const CHECK_INTERVAL_MINUTES = 60; // Check every hour

// Bug 3: default staggerMinutes was 5, which combined with hourly
// processSequences and a 100-contact campaign queued sends across multiple
// days (5 * 100 = 500 minutes ≈ 8.3h, then the hourly check pushes the tail
// further). 1 min still provides enough randomization to avoid a perfect
// burst pattern (especially combined with delayMs jitter elsewhere) while
// keeping a 100-contact day inside a single business-day window.
//
// staggerMinutes spaces out enrolled contacts so the first batch doesn't all
// hit LinkedIn at exactly 9am. 1 min default gives 100 contacts a 100-minute
// spread, reasonable for a single-day campaign window. processSequences
// runs hourly, so every send cycle picks up ~60 contacts in flight.
const DEFAULT_STAGGER_MINUTES = 1;
const DEFAULT_QUIET_HOURS_START = 8;  // 8am local
const DEFAULT_QUIET_HOURS_END = 20;   // 8pm local

// Serialize read-modify-write operations on sequence storage
let lockChain = Promise.resolve();
function withLock(fn) {
  const next = lockChain.then(fn, fn).catch((err) => {
    lockChain = Promise.resolve();
    throw err;
  });
  lockChain = next.then(() => {}, () => {});
  return next;
}

/**
 * Bug 2: get the hour-of-day for a timestamp in a specific IANA timezone.
 * Falls back to the host's local hour if the timezone is invalid.
 * @param {Date} date
 * @param {string} timezone - IANA TZ identifier (e.g. 'America/Los_Angeles')
 * @returns {number} Hour 0..23 in that timezone
 */
function getHourInZone(date, timezone) {
  if (!timezone || timezone === 'UTC') return date.getUTCHours();
  try {
    return parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour: 'numeric', hourCycle: 'h23'
    }).format(date), 10);
  } catch {
    return date.getHours(); // fallback to local
  }
}

/**
 * Bug 3: is the given timestamp on a sendable day for the sequence?
 * If `weekdaysOnly` is true, Saturdays and Sundays are not sendable.
 *
 * Bug 2: use STRICT equality (`=== true`) so a sequence with no
 * `weekdaysOnly` field (i.e. created before the field existed) is treated as
 * weekdaysOnly:false. The `??` operator would silently flip those old
 * sequences to weekday-only and shift Saturday sends to Monday, which would
 * be a behavior regression for existing users. New sequences explicitly set
 * `weekdaysOnly: true` in createSequence so the new default still applies
 * to anything created from now on.
 * @param {number} timestampMs
 * @param {string} timezone
 * @param {Object} sequence
 * @returns {boolean}
 */
function isSendableDay(timestampMs, timezone, sequence) {
  const weekdaysOnly = sequence?.settings?.weekdaysOnly === true;
  if (!weekdaysOnly) return true;
  try {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(new Date(timestampMs));
    return wd !== 'Sat' && wd !== 'Sun';
  } catch {
    const d = new Date(timestampMs).getDay();
    return d !== 0 && d !== 6;
  }
}

/**
 * Bug 28: quiet-hours window predicate that handles wrap-around windows.
 * For a normal window (start <= end, e.g. 8..20), valid hours are
 * [start, end). For a wrap-around window (start > end, e.g. 23..7), valid
 * hours are [start, 24) ∪ [0, end) — i.e. hour >= start OR hour < end.
 * @param {number} hour - 0..23
 * @param {number} start
 * @param {number} end
 * @returns {boolean}
 */
function inQuietWindow(hour, start, end) {
  if (start <= end) return hour >= start && hour < end;
  // Wrap-around (e.g. 23..7): valid is hour >= 23 OR hour < 7.
  return hour >= start || hour < end;
}

/**
 * Compute the next valid send time for a sequence, applying its quiet-hours
 * window (default 8..20) in the sequence's configured IANA timezone
 * (`sequence.settings.timezone`, default 'UTC'). When `weekdaysOnly` is true,
 * Saturday and Sunday are also skipped.
 *
 * Bug 2: previously used host-OS local time (`d.getHours()`), which gave the
 * wrong window for traveling users. Now uses `getHourInZone(date, timezone)`.
 * Bug 3: previously did not respect a weekday-only setting.
 *
 * The shifting math uses absolute ms arithmetic and a bounded loop (max 96
 * hour-by-hour iterations) so DST transitions and pathological tz quirks
 * cannot deadlock.
 *
 * @param {number} timestampMs - Candidate send time (epoch ms)
 * @param {Object} sequence - Sequence (reads sequence.settings)
 * @returns {number} Adjusted epoch ms
 */
export function nextSendableTime(timestampMs, sequence) {
  const tz = sequence?.settings?.timezone || 'UTC';
  const start = sequence?.settings?.quietHoursStart ?? DEFAULT_QUIET_HOURS_START;
  const end = sequence?.settings?.quietHoursEnd ?? DEFAULT_QUIET_HOURS_END;
  // Bug 2: strict equality so undefined → false (preserves behavior for
  // sequences created before the field existed).
  const weekdaysOnly = sequence?.settings?.weekdaysOnly === true;
  // If the window is the whole day, nothing to shift (assuming weekdaysOnly is off).
  if (start <= 0 && end >= 24 && !weekdaysOnly) {
    return timestampMs;
  }
  let t = timestampMs;
  // Bounded loop: 192 iterations (8 days) covers worst-case combinations
  // including narrow quiet windows + weekdaysOnly + weekend gaps. The previous
  // 96-iteration cap could return an out-of-window time when the configuration
  // required searching past a full weekend with a narrow quiet-hour band.
  for (let i = 0; i < 24 * 8; i++) {
    if (!isSendableDay(t, tz, sequence)) {
      t += 60 * 60 * 1000; // bump 1 hour at a time so weekend exit naturally
                            // lands on the very first hour of the next weekday,
                            // which the hour-window check then snaps to start.
      continue;
    }
    const hour = getHourInZone(new Date(t), tz);
    // Bug 28: support wrap-around quiet windows (e.g. 23..7 overnight).
    if (inQuietWindow(hour, start, end)) return t;
    // Advance one hour and re-check. Cheap and DST-safe.
    t += 60 * 60 * 1000;
  }
  // No valid window found in 8 days — log and fall back to the last
  // attempted time. Indicates an invalid quietHours/weekdaysOnly configuration.
  console.warn(`Sequence ${sequence?.id || '(unknown)'}: no sendable window found in 8 days; check quietHours/weekdaysOnly settings`);
  return t;
}

/**
 * Initialize the sequence manager.
 */
export function initSequenceManager() {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === SEQUENCE_ALARM) {
      await processSequences();
    }
  });

  // Check on startup and every hour
  chrome.alarms.create(SEQUENCE_ALARM, { periodInMinutes: CHECK_INTERVAL_MINUTES });
}

/**
 * Create a new sequence.
 * @param {Object} params
 * @param {string} params.name - Campaign name
 * @param {Object[]} params.steps - [{ delayDays, template, aiType? }]
 * @param {string} [params.goal] - Campaign goal for AI personalization
 * @param {Object} [params.settings] - { staggerMinutes, quietHoursStart, quietHoursEnd }
 * @returns {Promise<Object>} The created sequence
 */
export async function createSequence({ name, steps, goal, settings }) {
  return withLock(async () => {
    const sequences = await getSequences();
    const id = `seq_${Date.now().toString(36)}`;

    const sequence = {
      id,
      name,
      goal: goal || '',
      steps: steps.map((s, i) => ({
        index: i,
        delayDays: s.delayDays || (i === 0 ? 0 : 3),
        template: s.template || '',
        aiType: s.aiType || null
      })),
      settings: {
        staggerMinutes: settings?.staggerMinutes ?? DEFAULT_STAGGER_MINUTES,
        quietHoursStart: settings?.quietHoursStart ?? DEFAULT_QUIET_HOURS_START,
        quietHoursEnd: settings?.quietHoursEnd ?? DEFAULT_QUIET_HOURS_END,
        // Bug 2: explicit IANA timezone for quiet-hours interpretation. Defaults
        // to UTC so behavior is deterministic across machines / CI / users.
        timezone: settings?.timezone || 'UTC',
        // Bug 3: by default, do not send on weekends. Callers can set false
        // for sequences where weekend sends are intentional.
        weekdaysOnly: settings?.weekdaysOnly ?? true
      },
      contacts: {},
      stats: { enrolled: 0, sent: 0, replied: 0, completed: 0 },
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    sequences.items = sequences.items || {};
    sequences.items[id] = sequence;
    await saveSequences(sequences);
    return sequence;
  });
}

/**
 * Enroll contacts into a sequence.
 *
 * Staggers nextMessageAt across enrolled contacts (default 5 min apart) to
 * avoid bursting LinkedIn, and shifts each computed time into the sequence's
 * quiet-hours window (default 8am..8pm local).
 *
 * @param {string} sequenceId
 * @param {Object[]} contacts - [{ name, profileUrl, headline? }]
 * @returns {Promise<{apiVersion: 2, enrolled: number, skipped: Object[]}>}
 *   `skipped` describes any rows that were dropped:
 *     { reason: 'missing_profileUrl', contact } | { reason: 'duplicate', profileUrl }
 *   The `enrolled` count is preserved for backward compatibility.
 *
 * Bug 25: response shape is versioned via `apiVersion`. v1 was `{enrolled}`
 * only (pre-skipped-reporting). v2 adds `skipped[]`. New TS callers can pin
 * to v2; existing JS callers that ignore unknown fields keep working.
 */
export async function enrollContacts(sequenceId, contacts) {
  return withLock(async () => {
    const sequences = await getSequences();
    const sequence = sequences.items?.[sequenceId];
    if (!sequence) throw new Error(`Sequence ${sequenceId} not found`);

    const staggerMs = (sequence.settings?.staggerMinutes ?? DEFAULT_STAGGER_MINUTES) * 60 * 1000;
    const baseTime = Date.now();

    let enrolled = 0;
    const skipped = [];
    let staggerIndex = 0;
    for (const contact of contacts) {
      const key = contact.profileUrl;
      if (!key) {
        skipped.push({ reason: 'missing_profileUrl', contact });
        continue;
      }
      if (sequence.contacts[key]) {
        console.debug(`SequenceManager: skipping duplicate enrollment for ${key}`);
        skipped.push({ reason: 'duplicate', profileUrl: key });
        continue;
      }

      const candidate = baseTime + staggerIndex * staggerMs;
      const sendableMs = nextSendableTime(candidate, sequence);

      sequence.contacts[key] = {
        name: contact.name || '',
        headline: contact.headline || '',
        profileUrl: key,
        currentStep: 0,
        status: 'active',
        enrolledAt: new Date().toISOString(),
        lastMessageAt: null,
        nextMessageAt: new Date(sendableMs).toISOString(),
        messages: []
      };
      enrolled++;
      staggerIndex++;
    }

    sequence.stats.enrolled += enrolled;
    sequence.updatedAt = new Date().toISOString();
    await saveSequences(sequences);
    // Bug 25: explicit apiVersion so callers can detect the response shape.
    return { apiVersion: 2, enrolled, skipped };
  });
}

/**
 * Mark a contact as replied (stops the sequence for them).
 * @param {string} sequenceId
 * @param {string} profileUrl
 */
export async function markReplied(sequenceId, profileUrl) {
  return withLock(async () => {
    const sequences = await getSequences();
    const sequence = sequences.items?.[sequenceId];
    const contact = sequence?.contacts?.[profileUrl];
    if (sequence && contact) {
      if (contact.status !== 'active') return;
      contact.status = 'replied';
      sequence.stats.replied++;
      await saveSequences(sequences);
    }
  });
}

/**
 * Get all sequences.
 * @returns {Promise<Object>}
 */
export async function getSequences() {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEYS.DATA_SEQUENCES, (result) => {
      resolve(result[STORAGE_KEYS.DATA_SEQUENCES] || { items: {} });
    });
  });
}

/**
 * Get a single sequence by ID.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getSequence(id) {
  const sequences = await getSequences();
  return sequences.items?.[id] || null;
}

/**
 * Delete a sequence.
 * @param {string} id
 */
export async function deleteSequence(id) {
  return withLock(async () => {
    const sequences = await getSequences();
    if (sequences.items) delete sequences.items[id];
    await saveSequences(sequences);
  });
}

/**
 * Pause/resume a sequence.
 * @param {string} id
 * @param {string} status - 'active' or 'paused'
 */
export async function setSequenceStatus(id, status) {
  return withLock(async () => {
    const sequences = await getSequences();
    if (sequences.items?.[id]) {
      sequences.items[id].status = status;
      await saveSequences(sequences);
    }
  });
}

/**
 * Defensive deep copy for handing a contact to downstream consumers.
 * Without this, callers can mutate `contact.messages` and bypass the lock
 * that protects sequence storage. structuredClone is available in Node 17+
 * and all supported Chrome versions; we fall back to JSON for older runtimes.
 */
function safeClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * Process all active sequences — find contacts due for their next message.
 * Called hourly by chrome.alarms.
 *
 * This function does NOT mutate sequence state. The AI personalization call
 * can take up to 30s and we don't want to hold a lock for that long, nor do
 * we want a stale in-memory snapshot to clobber concurrent writes from
 * markReplied/enrollContacts/recordMessageSent. Status transitions to
 * 'completed' happen in recordMessageSent after the message is actually
 * confirmed sent; orphaned contacts (currentStep past end of steps, e.g.
 * after a sequence's steps were shortened) are reaped under a lock by
 * reapCompletedContacts().
 *
 * @returns {Promise<Object[]>} Messages ready to send
 */
export async function processSequences() {
  // Bug 34: previously this function called reapCompletedContacts() (which
  // does its own withLock + getSequences + saveSequences) and then immediately
  // called getSequences() again. That's a redundant storage read on every
  // hourly tick. Consolidate: do the reap inline under the single lock and
  // reuse the post-reap snapshot for the read-only "ready messages" pass.
  const sequences = await withLock(async () => {
    const seqs = await getSequences();
    let dirty = false;
    for (const sequence of Object.values(seqs.items || {})) {
      if (sequence.status !== 'active') continue;
      for (const contact of Object.values(sequence.contacts || {})) {
        if (contact.status !== 'active') continue;
        if (contact.currentStep >= (sequence.steps || []).length) {
          contact.status = 'completed';
          sequence.stats.completed++;
          dirty = true;
        }
      }
    }
    if (dirty) await saveSequences(seqs);
    return seqs;
  });

  const readyMessages = [];
  const now = new Date();

  for (const [seqId, sequence] of Object.entries(sequences.items || {})) {
    if (sequence.status !== 'active') continue;

    for (const [profileUrl, contact] of Object.entries(sequence.contacts)) {
      if (contact.status !== 'active') continue;
      if (contact.currentStep >= sequence.steps.length) continue;

      const nextTime = new Date(contact.nextMessageAt);
      if (nextTime > now) continue; // Not due yet

      const step = sequence.steps[contact.currentStep];
      if (!step) continue;

      let messageText = step.template || '';

      // AI personalization if configured (no lock held — call may take up to 30s)
      if (step.aiType) {
        try {
          const aiResult = await AI.chat({
            systemPrompt: getSequencePrompt(step.aiType, sequence.goal),
            userMessage: JSON.stringify({
              recipientName: contact.name,
              recipientHeadline: contact.headline,
              template: step.template,
              stepNumber: contact.currentStep + 1,
              totalSteps: sequence.steps.length,
              previousMessages: (contact.messages || []).map(m => m.text)
            }),
            jsonMode: true
          });
          if (aiResult.parsed?.message && aiResult.parsed.message.trim()) {
            messageText = aiResult.parsed.message;
          }
        } catch (err) {
          console.warn('Sequence AI personalization failed, using template:', err.message);
        }
      }

      // Replace basic template variables
      const contactName = contact.name || '';
      messageText = messageText
        .replace(/\{name\}/g, contactName.split(' ')[0] || contactName)
        .replace(/\{fullName\}/g, contactName)
        .replace(/\{headline\}/g, contact.headline || '');

      readyMessages.push({
        sequenceId: seqId,
        profileUrl,
        // Defensive deep copy — without this, mutations to contact.messages by
        // downstream consumers would alias and potentially corrupt the live
        // storage snapshot held in `sequences`.
        contact: safeClone(contact),
        messageText,
        step: contact.currentStep
      });
    }
  }

  return readyMessages;
}

/**
 * Mark any active contacts whose currentStep is at or past the end of their
 * sequence as 'completed'. Runs under the same lock as other mutators so it
 * cannot race them.
 *
 * Bug 34: `processSequences` now does the reap inline to avoid a second
 * `getSequences` read. This helper is retained as an exported entry point
 * for tests and any callers that want to reap without immediately processing.
 */
export async function reapCompletedContacts() {
  return withLock(async () => {
    const sequences = await getSequences();
    let dirty = false;
    for (const sequence of Object.values(sequences.items || {})) {
      if (sequence.status !== 'active') continue;
      for (const contact of Object.values(sequence.contacts || {})) {
        if (contact.status !== 'active') continue;
        if (contact.currentStep >= (sequence.steps || []).length) {
          contact.status = 'completed';
          sequence.stats.completed++;
          dirty = true;
        }
      }
    }
    if (dirty) await saveSequences(sequences);
  });
}

/**
 * Record that a message was sent successfully.
 * IMPORTANT: Only call this AFTER confirming the message was actually delivered
 * on LinkedIn. Calling before confirmation risks marking contacts as completed
 * when their last message was never sent.
 *
 * @param {string} sequenceId
 * @param {string} profileUrl
 * @param {string} messageText - The actual text that was sent
 */
export async function recordMessageSent(sequenceId, profileUrl, messageText) {
  return withLock(async () => {
    const sequences = await getSequences();
    const sequence = sequences.items?.[sequenceId];
    const contact = sequence?.contacts?.[profileUrl];
    if (!contact) return;
    // Bug 27: gate on contact.status. After markReplied flips status to
    // 'replied', a subsequent or concurrent recordMessageSent (queued in the
    // lock chain behind markReplied) must NOT advance currentStep or schedule
    // the next message — that defeats reply detection. Same for 'completed'.
    if (contact.status !== 'active') {
      console.debug(`SequenceManager: skipping recordMessageSent for ${profileUrl} (status=${contact.status})`);
      return;
    }

    contact.messages.push({
      step: contact.currentStep,
      text: messageText,
      sentAt: new Date().toISOString()
    });

    contact.lastMessageAt = new Date().toISOString();
    contact.currentStep++;
    sequence.stats.sent++;

    // Schedule next message
    if (contact.currentStep < sequence.steps.length) {
      const nextStep = sequence.steps[contact.currentStep];
      // Use absolute ms arithmetic instead of setDate(getDate()+N) so DST
      // boundaries cannot skip or duplicate an hour.
      const candidateMs = Date.now() + (nextStep.delayDays || 3) * 86400 * 1000;
      const sendableMs = nextSendableTime(candidateMs, sequence);
      contact.nextMessageAt = new Date(sendableMs).toISOString();
    } else {
      contact.status = 'completed';
      sequence.stats.completed++;
    }

    sequence.updatedAt = new Date().toISOString();
    await saveSequences(sequences);
  });
}

/**
 * Bug 31 / Bug 26: re-stagger active contacts in a sequence after settings change.
 *
 * When a user updates `staggerMinutes` (or quiet-hours / timezone /
 * weekdaysOnly) on a sequence, that change normally only affects future
 * enrollments — the existing contacts keep the `nextMessageAt` they got
 * when they were enrolled. This export lets callers (CLI / message router)
 * recompute send times against the current settings.
 *
 * Re-staggers ALL active contacts (both initial-batch and mid-sequence):
 *   - Initial batch (no messages yet): gets a new staggered first-send time.
 *   - Mid-sequence (already received messages): gets a new `nextMessageAt`
 *     while preserving `lastMessageAt`. Their next message is restaggered
 *     into the new window — useful when the user widens/narrows the
 *     campaign's send window or shifts timezone.
 *
 * Skips contacts whose status is not 'active' (replied/completed) and
 * those that have no `nextMessageAt` (nothing scheduled to restagger).
 *
 * @param {string} sequenceId
 * @returns {Promise<{restaggered: number}|{error: string}>}
 */
export async function restagger(sequenceId) {
  return withLock(async () => {
    const sequences = await getSequences();
    const sequence = sequences.items?.[sequenceId];
    if (!sequence) return { error: 'sequence not found' };
    const stagger = (sequence.settings?.staggerMinutes ?? DEFAULT_STAGGER_MINUTES) * 60 * 1000;
    const baseTime = Date.now();
    let i = 0;
    let restaggered = 0;
    for (const contact of Object.values(sequence.contacts || {})) {
      if (contact.status !== 'active') continue;
      // Only restagger contacts with a future nextMessageAt set.
      if (!contact.nextMessageAt) continue;
      const desiredTs = baseTime + (i * stagger);
      contact.nextMessageAt = new Date(nextSendableTime(desiredTs, sequence)).toISOString();
      i++;
      restaggered++;
    }
    sequence.updatedAt = new Date().toISOString();
    await saveSequences(sequences);
    return { restaggered };
  });
}

// --- Helpers ---

function saveSequences(data) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEYS.DATA_SEQUENCES]: data }, resolve);
  });
}

function getSequencePrompt(aiType, goal) {
  const prompts = {
    personalize: `You are a professional LinkedIn outreach expert. Personalize the message template for the given recipient. Keep it concise (under 300 chars), natural, and relevant to their headline/role.${goal ? ` Campaign goal: ${goal}` : ''} Return JSON: { "message": "the personalized message" }`,

    followup: `You are writing a follow-up LinkedIn message. Be brief, reference the previous outreach without being pushy, and offer value.${goal ? ` Campaign goal: ${goal}` : ''} Return JSON: { "message": "the follow-up message" }`,

    final: `You are writing a final follow-up LinkedIn message. Be gracious, leave the door open, and make it easy to say yes or no.${goal ? ` Campaign goal: ${goal}` : ''} Return JSON: { "message": "the final message" }`
  };
  return prompts[aiType] || prompts.personalize;
}
