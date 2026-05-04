/**
 * JSON-backed adapter that mimics chrome.storage.local for Node.
 *
 * Stored at ~/.fusenlink/state.json. All reads come from an in-memory cache
 * loaded once at startup; writes flush synchronously to disk and notify
 * onChanged subscribers (so ai-client's cache invalidation listener works).
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
