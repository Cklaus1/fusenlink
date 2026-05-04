/**
 * MessageRouter — central message handler for the background service worker.
 * Replaces the old bare onMessage listener in background.js.
 */

import { MSG } from '../shared/messages.js';
import { DEFAULT_DAILY_LIMITS } from '../shared/constants.js';
import * as Store from './playbook-store.js';
import { getSchedules, setSchedule, deleteSchedule } from './scheduler.js';
import * as AI from './ai-client.js';
import * as Data from './data-store.js';
import * as Seq from './sequence-manager.js';
import { checkForReplies } from './reply-detector.js';
import * as Cohort from './cohort-manager.js';
import { getTargetLinkedInTab } from './tab-selector.js';

/**
 * Initialize the message router.
 */
export function initMessageRouter() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender, sendResponse);
    return true; // Keep channel open for async responses
  });
}

/**
 * Route a message to the appropriate handler.
 */
export async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.action) {
      // Settings (backwards compatible with old message format)
      case MSG.GET_SETTINGS: {
        const settings = await Store.getSettings();
        sendResponse(settings);
        break;
      }

      case MSG.SET_SETTINGS: {
        if (message.settings) {
          await Store.saveSettings(message.settings);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No settings provided' });
        }
        break;
      }

      // Playbook CRUD
      case MSG.GET_PLAYBOOK: {
        const playbook = await Store.getPlaybook(message.playbookId);
        sendResponse(playbook);
        break;
      }

      case MSG.GET_ALL_PLAYBOOKS: {
        const playbooks = await Store.getAllPlaybooks();
        sendResponse(playbooks);
        break;
      }

      case MSG.SAVE_PLAYBOOK: {
        if (message.playbook) {
          await Store.savePlaybook(message.playbook);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No playbook provided' });
        }
        break;
      }

      case MSG.DELETE_PLAYBOOK: {
        if (message.playbookId) {
          await Store.deletePlaybook(message.playbookId);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No playbookId provided' });
        }
        break;
      }

      // Selector registries
      case MSG.GET_SELECTORS: {
        const selectors = await Store.getSelectors(message.registryKey);
        sendResponse(selectors);
        break;
      }

      case MSG.SAVE_SELECTORS: {
        if (message.registryKey && message.registry) {
          await Store.saveSelectors(message.registryKey, message.registry);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Missing registryKey or registry' });
        }
        break;
      }

      // Scheduling
      case MSG.GET_SCHEDULES: {
        const schedules = await getSchedules();
        sendResponse(schedules);
        break;
      }

      case MSG.SET_SCHEDULE: {
        if (message.playbookId && message.config) {
          await setSchedule(message.playbookId, message.config);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Missing playbookId or config' });
        }
        break;
      }

      case MSG.DELETE_SCHEDULE: {
        if (message.playbookId) {
          await deleteSchedule(message.playbookId);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Missing playbookId' });
        }
        break;
      }

      // Playbook execution — forward to content script on active LinkedIn tab
      case MSG.RUN_PLAYBOOK: {
        const tab = await getTargetLinkedInTab(message.playbookId);
        if (!tab) {
          sendResponse({ error: 'No LinkedIn tab open' });
          break;
        }
        chrome.tabs.sendMessage(tab.id, {
          type: MSG.RUN_PLAYBOOK,
          playbookId: message.playbookId
        }, (result) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse(result || { status: 'started' });
          }
        });
        break;
      }

      case MSG.STOP_PLAYBOOK: {
        const tab = await getTargetLinkedInTab();
        if (!tab) {
          sendResponse({ status: 'no_tab' });
          break;
        }
        chrome.tabs.sendMessage(tab.id, { type: MSG.STOP_PLAYBOOK }, (result) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse(result || { status: 'stop_sent' });
          }
        });
        break;
      }

      case MSG.GET_STATUS: {
        const tab = await getTargetLinkedInTab();
        if (!tab) {
          sendResponse({ status: 'no_tab' });
          break;
        }
        chrome.tabs.sendMessage(tab.id, { type: MSG.GET_STATUS }, (result) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse(result || { status: 'unknown' });
          }
        });
        break;
      }

      // AI
      case MSG.AI_REQUEST: {
        const result = await AI.chat({
          systemPrompt: message.systemPrompt || getDefaultPrompt(message.aiType),
          userMessage: typeof message.input === 'string'
            ? message.input
            : JSON.stringify(message.input, null, 2),
          jsonMode: message.jsonMode !== false  // default true; explicit false respected
        });
        sendResponse(result);
        break;
      }

      case MSG.AI_CONFIGURE: {
        if (message.config) {
          await AI.saveConfig(message.config);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No config provided' });
        }
        break;
      }

      case MSG.AI_STATUS: {
        const status = await AI.getStatus();
        sendResponse(status);
        break;
      }

      // Data store
      case MSG.STORE_DATA: {
        const result = await Data.storeData(
          message.collection,
          message.data,
          message.options || {}
        );
        sendResponse(result);
        break;
      }

      // Bug 14: expose dailyLimits via message-router so CLI can manage them
      case MSG.GET_DAILY_LIMITS: {
        const result = await new Promise(r => chrome.storage.local.get('dailyLimits', r));
        sendResponse(result.dailyLimits || DEFAULT_DAILY_LIMITS);
        break;
      }

      case MSG.SET_DAILY_LIMITS: {
        // Bug 31: validate input shape — coerce strings, drop invalid keys,
        // reject anything that isn't an object.
        if (!message.limits || typeof message.limits !== 'object') {
          sendResponse({ success: false, error: 'limits must be an object' });
          break;
        }
        const cleaned = {};
        for (const [k, v] of Object.entries(message.limits)) {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n >= 0 && n <= 10000) {
            cleaned[k] = n;
          }
        }
        await new Promise(r => chrome.storage.local.set({ dailyLimits: cleaned }, r));
        sendResponse({ success: true, applied: cleaned });
        break;
      }

      case MSG.LOG_ACTIVITY: {
        const result = await Data.logActivity(message.entry || {});
        sendResponse(result || { success: true });
        break;
      }

      case MSG.GET_DATA: {
        const data = await Data.getData(message.collection, message.options || {});
        sendResponse(data);
        break;
      }

      case MSG.DELETE_DATA: {
        const result = await Data.deleteData(message.collection);
        sendResponse(result);
        break;
      }

      // Sequences
      case MSG.CREATE_SEQUENCE: {
        const seq = await Seq.createSequence(message);
        sendResponse(seq);
        break;
      }
      case MSG.GET_SEQUENCES: {
        const seqs = await Seq.getSequences();
        sendResponse(seqs);
        break;
      }
      case MSG.GET_SEQUENCE: {
        const seq = await Seq.getSequence(message.sequenceId);
        sendResponse(seq);
        break;
      }
      case MSG.DELETE_SEQUENCE: {
        await Seq.deleteSequence(message.sequenceId);
        sendResponse({ success: true });
        break;
      }
      case MSG.ENROLL_CONTACTS: {
        const result = await Seq.enrollContacts(message.sequenceId, message.contacts);
        sendResponse(result);
        break;
      }
      case MSG.MARK_REPLIED: {
        await Seq.markReplied(message.sequenceId, message.profileUrl);
        sendResponse({ success: true });
        break;
      }
      case MSG.PROCESS_SEQUENCES: {
        const ready = await Seq.processSequences();
        sendResponse(ready);
        break;
      }
      case MSG.RECORD_MESSAGE_SENT: {
        await Seq.recordMessageSent(message.sequenceId, message.profileUrl, message.messageText);
        sendResponse({ success: true });
        break;
      }
      case MSG.SET_SEQUENCE_STATUS: {
        await Seq.setSequenceStatus(message.sequenceId, message.status);
        sendResponse({ success: true });
        break;
      }
      case MSG.RESTAGGER_SEQUENCE: {
        const result = await Seq.restagger(message.sequenceId);
        sendResponse(result || { error: 'Sequence not found' });
        break;
      }

      case MSG.CHECK_REPLIES: {
        const result = await checkForReplies();
        sendResponse(result);
        break;
      }

      // Cohort
      case MSG.GET_COHORT: {
        const config = await Cohort.getCohortConfig();
        sendResponse(config);
        break;
      }
      case MSG.SAVE_COHORT: {
        await Cohort.saveCohortConfig(message.config);
        sendResponse({ success: true });
        break;
      }
      case MSG.SYNC_COHORT: {
        await Cohort.syncCohortData();
        sendResponse({ success: true });
        break;
      }
      case MSG.GET_LEADERBOARD: {
        const lb = await Cohort.getLeaderboard();
        sendResponse(lb);
        break;
      }
      case MSG.GET_CONTENT_CALENDAR: {
        const cal = await Cohort.getContentCalendar();
        sendResponse(cal);
        break;
      }
      case MSG.GET_SHARED_TEMPLATES: {
        const templates = await Cohort.getSharedTemplates();
        sendResponse(templates);
        break;
      }
      case MSG.DETECT_WARM_INTROS: {
        const intros = await Cohort.detectWarmIntros(message.targetProfileUrl);
        sendResponse(intros);
        break;
      }
      case MSG.UPLOAD_MY_CONNECTIONS: {
        const result = await Cohort.uploadMyConnections();
        sendResponse({ success: result });
        break;
      }

      // Tab management
      case 'openTab': {
        if (message.url) {
          const tab = await chrome.tabs.create({ url: message.url, active: false });
          sendResponse({ success: true, tabId: tab.id });
        } else {
          sendResponse({ success: false, error: 'No URL provided' });
        }
        break;
      }

      default:
        sendResponse({ error: `Unknown action: ${message.action}` });
    }
  } catch (err) {
    console.error('MessageRouter error:', err);
    sendResponse({ error: err.message });
  }
}

/**
 * Get a default system prompt for an AI request type.
 * @param {string} aiType
 * @returns {string}
 */
function getDefaultPrompt(aiType) {
  const prompts = {
    profile_review: `You are a LinkedIn profile optimization expert. Analyze the provided profile data and return a JSON object with:
- "score": overall score 1-100
- "summary": 2-3 sentence overview
- "strengths": array of strengths
- "improvements": array of specific, actionable improvement suggestions
- "headline_suggestions": array of 3 alternative headlines`,

    classify_inbox: `You are an inbox analyst. Classify each conversation by priority and intent. Return a JSON object with:
- "digest": 2-3 sentence summary of the inbox state
- "highPriority": array of conversations needing attention (with name, reason, suggestedAction)
- "lowPriority": array of conversations that can wait
- "spam": array of spam/sales messages`,

    draft_reply: `You are a professional LinkedIn communicator. Draft 2 reply options for the given message. Return a JSON object with:
- "options": array of 2 objects, each with "tone" (friendly/professional) and "text" (the reply, 1-3 sentences)`,

    connection_note: `You are a networking expert. Write a short, personalized connection request note (max 300 chars) based on the person's profile info. Return JSON with:
- "text": the connection note
- "reasoning": why this note should work`,

    extract_summary: `Summarize the provided LinkedIn page content. Return JSON with:
- "summary": concise summary of the page
- "keyInfo": object with extracted key data points`,

    interactive_step: `You are an AI agent controlling a LinkedIn browser automation extension.
Analyze the current page state and decide what actions to take. Respond with JSON:
{ "reasoning": "...", "steps": [action objects], "done": false }
Or to finish: { "reasoning": "...", "summary": "...", "done": true }
Available actions: extract, click, find, findAll, navigate, scroll, wait, typeText, getPageContent, log, prompt, done.`,

    draft_post: `You are a LinkedIn content strategist for startup founders. Write a compelling LinkedIn post based on the given topic.

Rules:
- First line must be a hook (bold insight, surprising stat, or contrarian take)
- 150-300 words, short paragraphs (1-2 sentences each)
- Use line breaks between paragraphs for readability
- End with a question or call-to-action to drive comments
- No hashtags in the body (add 3-5 at the very end)
- Authentic founder voice, not corporate
- Include a personal anecdote or specific example when possible

Return JSON: { "text": "the full post text", "hook": "the opening line" }`,

    draft_comment: `You are helping a startup founder engage meaningfully with LinkedIn content. Write a substantive comment on the given post.

Rules:
- 2-3 sentences, not more
- Add genuine value: a related insight, respectful counterpoint, or specific experience
- Never write "Great post!" or generic praise
- Reference something specific from the post content
- Sound like a thoughtful human, not a bot
- Match the tone of the original post

Return JSON: { "text": "the comment text" }`
  };

  return prompts[aiType] || 'You are a helpful assistant. Respond in JSON format.';
}
