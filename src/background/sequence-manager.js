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

import { STORAGE_KEYS } from '../shared/constants.js';
import { MSG } from '../shared/messages.js';
import * as AI from './ai-client.js';

const SEQUENCE_ALARM = 'sequence-check';
const CHECK_INTERVAL_MINUTES = 60; // Check every hour

const DEFAULT_STAGGER_MINUTES = 5;
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
 * Compute the next valid send time for a sequence, applying its quiet-hours
 * window (default 8..20 in user's local time). If the candidate timestamp
 * falls before the quiet-hours start hour on its local day, it is shifted
 * forward to that day's quiet-hours start. If it falls at or after the end
 * hour, it is shifted to the next day's quiet-hours start.
 *
 * Uses local-time getHours / setHours; date arithmetic uses absolute ms
 * (Date.now() + N*86400000) so DST transitions cannot skip or duplicate
 * an hour at the day boundary.
 *
 * @param {number} timestamp - Candidate send time (epoch ms)
 * @param {Object} sequence - Sequence (reads sequence.settings)
 * @returns {number} Adjusted epoch ms
 */
export function nextSendableTime(timestamp, sequence) {
  const start = sequence?.settings?.quietHoursStart ?? DEFAULT_QUIET_HOURS_START;
  const end = sequence?.settings?.quietHoursEnd ?? DEFAULT_QUIET_HOURS_END;
  const d = new Date(timestamp);
  const hour = d.getHours();
  if (hour < start) {
    d.setHours(start, 0, 0, 0);
    return d.getTime();
  }
  if (hour >= end) {
    // Advance one local day, then snap to start hour.
    // Use ms arithmetic to avoid DST hour-skip in setDate(getDate()+1).
    const next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    next.setHours(start, 0, 0, 0);
    return next.getTime();
  }
  return timestamp;
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
        quietHoursEnd: settings?.quietHoursEnd ?? DEFAULT_QUIET_HOURS_END
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
 * @returns {Promise<{enrolled: number, skipped: Object[]}>}
 *   `skipped` describes any rows that were dropped:
 *     { reason: 'missing_profileUrl', contact } | { reason: 'duplicate', profileUrl }
 *   The `enrolled` count is preserved for backward compatibility.
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
    return { enrolled, skipped };
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
  // Reap any contacts whose currentStep is past the end of steps (locked).
  await reapCompletedContacts();

  const sequences = await getSequences();
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
 */
async function reapCompletedContacts() {
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
