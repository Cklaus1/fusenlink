/**
 * JSON-backed adapter that mimics chrome.storage.local for Node.
 *
 * Stored at ~/.fusenlink/state.json. To stay safe across multiple
 * concurrent processes (e.g. the persistent `attach` shell + a one-shot
 * `run` CLI invocation, or two `update-ai-config` scripts), every read
 * and write rebuilds the in-memory cache from disk first. This avoids
 * the previous bug where a long-lived process loaded the file once at
 * startup and later flushed its stale cache, clobbering keys other
 * processes had written in the meantime.
 *
 * Cost: a small synchronous JSON read per operation. The file is small
 * and operations are infrequent, so this is fine in practice.
 */

import { promises as fs } from 'node:fs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const STATE_DIR = path.join(os.homedir(), '.fusenlink');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

let cache = {};
const listeners = [];

function loadFromDisk() {
  ensureStateDir();
  if (!existsSync(STATE_FILE)) {
    cache = {};
    return;
  }
  try {
    cache = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch (err) {
    console.warn('[storage] failed to read state file, starting empty:', err.message);
    cache = {};
  }
}

function flushToDisk() {
  ensureStateDir();
  writeFileSync(STATE_FILE, JSON.stringify(cache, null, 2));
}

// Initial load (kept for parity with previous behavior; every op also reloads).
loadFromDisk();

function normalizeKeys(keys) {
  if (keys == null) return Object.keys(cache);
  if (typeof keys === 'string') return [keys];
  if (Array.isArray(keys)) return keys;
  if (typeof keys === 'object') return Object.keys(keys);
  return [];
}

function notify(changes) {
  for (const cb of listeners) {
    try { cb(changes, 'local'); } catch (err) { console.warn('[storage] listener error:', err.message); }
  }
}

/** Public API mirroring chrome.storage.local + chrome.storage.onChanged */
export const storageApi = {
  local: {
    get(keys, cb) {
      loadFromDisk();
      const list = normalizeKeys(keys);
      const out = {};
      for (const k of list) {
        if (cache[k] !== undefined) out[k] = cache[k];
      }
      // Default values from object form
      if (keys && typeof keys === 'object' && !Array.isArray(keys)) {
        for (const [k, v] of Object.entries(keys)) {
          if (out[k] === undefined) out[k] = v;
        }
      }
      queueMicrotask(() => cb && cb(out));
    },
    set(items, cb) {
      // Re-read first so we merge into the latest on-disk state instead of
      // clobbering keys other processes wrote since our last load.
      loadFromDisk();
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: cache[k], newValue: v };
        cache[k] = v;
      }
      flushToDisk();
      notify(changes);
      queueMicrotask(() => cb && cb());
    },
    remove(keys, cb) {
      loadFromDisk();
      const list = normalizeKeys(keys);
      const changes = {};
      for (const k of list) {
        if (cache[k] !== undefined) {
          changes[k] = { oldValue: cache[k], newValue: undefined };
          delete cache[k];
        }
      }
      flushToDisk();
      notify(changes);
      queueMicrotask(() => cb && cb());
    },
    clear(cb) {
      loadFromDisk();
      const changes = {};
      for (const k of Object.keys(cache)) {
        changes[k] = { oldValue: cache[k], newValue: undefined };
      }
      cache = {};
      flushToDisk();
      notify(changes);
      queueMicrotask(() => cb && cb());
    }
  },
  // chrome.storage.sync — used only by the v1→v2 migrator. Empty stub is fine.
  sync: {
    get(keys, cb) { queueMicrotask(() => cb && cb({})); },
    set(items, cb) { queueMicrotask(() => cb && cb()); },
    remove(keys, cb) { queueMicrotask(() => cb && cb()); }
  },
  onChanged: {
    addListener(cb) { listeners.push(cb); }
  }
};

export function getStateFilePath() { return STATE_FILE; }
