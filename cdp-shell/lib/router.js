/**
 * Wraps the existing src/background/message-router.handleMessage so the CDP
 * shell can dispatch chrome.runtime.sendMessage payloads from the page through
 * the same code paths the service worker uses in extension mode.
 *
 * Side-effect imports order matters: node-chrome-stub MUST run before the
 * background modules so their module-load-time chrome.* references resolve.
 */

import './node-chrome-stub.js';
import { initializeDefaults } from '../../src/background/playbook-store.js';
import { handleMessage } from '../../src/background/message-router.js';

let initialized = false;

// Actions in the background router that depend on chrome.tabs (which isn't
// available in shell mode). When the page-side bundle hits these, we short-
// circuit with a clear error rather than letting handleMessage fall back to
// the empty stub and produce confusing "No LinkedIn tab open" messages.
const TAB_BOUND_ACTIONS = new Set([
  'runPlaybook',
  'stopPlaybook',
  'getPlaybookStatus'
]);

/**
 * Ensure default playbooks/selectors/settings are seeded into storage.
 * Idempotent — safe to call before every command.
 */
export async function ensureInitialized() {
  if (initialized) return;
  await initializeDefaults();
  initialized = true;
}

/**
 * Route a message through the existing background message router.
 * @param {Object} message - chrome.runtime.sendMessage payload
 * @returns {Promise<any>} the response sent via sendResponse
 */
export function route(message) {
  // Intercept tab-bound actions before delegating. In CDP shell mode the
  // chrome.tabs API is stubbed empty, so handleMessage would respond with
  // "No LinkedIn tab open" or similar. The CLI exposes session.run/stop/status
  // which call deliver() directly into the page — that's the correct path.
  if (message && TAB_BOUND_ACTIONS.has(message.action)) {
    return Promise.resolve({
      error: `Action "${message.action}" requires chrome.tabs which is unavailable in CDP shell mode. ` +
             `Use the shell's session.${message.action === 'runPlaybook' ? 'run' : message.action === 'stopPlaybook' ? 'stop' : 'status'}() ` +
             `methods (e.g. \`fusenlink-cdp run <playbook-id>\`) instead.`
    });
  }

  return new Promise((resolve) => {
    let resolved = false;
    const sendResponse = (data) => {
      if (resolved) return;
      resolved = true;
      resolve(data);
    };
    // handleMessage is async but uses sendResponse to return values
    Promise.resolve(handleMessage(message, null, sendResponse)).catch((err) => {
      if (!resolved) {
        resolved = true;
        resolve({ error: err.message });
      }
    });
    // Safety: if a handler forgets to sendResponse, time out after 60s
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ error: 'router timeout' });
      }
    }, 180000);  // 3 min — accommodates AI calls to "thinking" models with retries
  });
}
