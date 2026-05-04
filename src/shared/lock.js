/**
 * Shared mutex helper to serialize read-modify-write operations keyed by an
 * arbitrary string (typically a chrome.storage key). Always resets the lock
 * chain on error so a single failure doesn't poison subsequent calls.
 */

const locks = {};

export function withLock(key, fn) {
  const prev = locks[key] || Promise.resolve();
  const next = prev.then(fn, fn).catch((err) => {
    locks[key] = Promise.resolve();
    throw err;
  });
  locks[key] = next.then(() => {}, () => {});
  return next;
}
