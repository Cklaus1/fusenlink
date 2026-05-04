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
    }, 60000);
  });
}
