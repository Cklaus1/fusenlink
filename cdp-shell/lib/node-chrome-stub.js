/**
 * Minimal `globalThis.chrome` shim for running src/background modules in Node.
 *
 * Background modules (message-router, ai-client, data-store, sequence-manager,
 * etc.) are written for an MV3 service worker. They reference chrome.alarms,
 * chrome.notifications, chrome.tabs, chrome.runtime, chrome.storage at module
 * load time. We stub each surface with no-ops, except chrome.storage which is
 * backed by a JSON file on disk.
 *
 * Import this BEFORE any `src/background/*` module.
 */

import { storageApi } from './storage.js';

if (!globalThis.chrome) globalThis.chrome = {};

// alarms — the CDP shell is one-shot. No periodic execution.
globalThis.chrome.alarms = globalThis.chrome.alarms || {
  create: () => {},
  clear: (_n, cb) => cb && cb(true),
  get: (_n, cb) => cb && cb(null),
  getAll: (cb) => cb && cb([]),
  onAlarm: { addListener: () => {} }
};

// notifications — replace with stdout in shell mode.
globalThis.chrome.notifications = globalThis.chrome.notifications || {
  create: (id, opts) => {
    const tag = opts?.title || 'fusenlink';
    const msg = opts?.message || '';
    console.log(`[notification] ${tag}: ${msg}`);
  }
};

// tabs — the shell drives ONE page via CDP, no tab management is needed
// at the background-module level. Stubs return empty results so any code
// that accidentally touches them degrades gracefully instead of crashing.
globalThis.chrome.tabs = globalThis.chrome.tabs || {
  query: (_q, cb) => cb && cb([]),
  sendMessage: (_id, _msg, cb) => cb && cb(),
  create: (opts, cb) => cb && cb({ id: 0, url: opts?.url }),
  update: (_id, _opts, cb) => cb && cb({}),
  get: (_id, cb) => cb && cb({}),
  onUpdated: { addListener: () => {}, removeListener: () => {} },
  onRemoved: { addListener: () => {}, removeListener: () => {} }
};

// scripting — only used by scheduler's injection retry. No-op here.
globalThis.chrome.scripting = globalThis.chrome.scripting || {
  executeScript: async () => []
};

// runtime — onMessage/onInstalled/onStartup listeners are registered by
// background modules but never fired in shell mode (we call handleMessage
// directly). lastError defaults to null.
globalThis.chrome.runtime = globalThis.chrome.runtime || {
  onMessage: { addListener: () => {} },
  onInstalled: { addListener: () => {} },
  onStartup: { addListener: () => {} },
  sendMessage: (msg, cb) => cb && cb(null),
  lastError: null,
  getManifest: () => ({ version: '2.0.0-cdp' })
};

// storage — real, JSON-backed.
globalThis.chrome.storage = storageApi;
