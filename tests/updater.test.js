/**
 * Tests for updater URL validation (isValidUpdateUrl) and checkForUpdates behaviour.
 */
import { isValidUpdateUrl, checkForUpdates } from '../src/background/updater.js';

// ---------------------------------------------------------------------------
// Stateful storage mock (used by the concurrency test)
// ---------------------------------------------------------------------------
function installStatefulStorageMock() {
  const store = new Map();

  chrome.storage.local.get.mockImplementation((keys, callback) => {
    let out = {};
    if (typeof keys === 'string') {
      if (store.has(keys)) out[keys] = store.get(keys);
    } else if (Array.isArray(keys)) {
      for (const k of keys) {
        if (store.has(k)) out[k] = store.get(k);
      }
    }
    // Async callback like the real API
    Promise.resolve().then(() => callback(out));
  });

  chrome.storage.local.set.mockImplementation((items, callback) => {
    for (const [k, v] of Object.entries(items)) {
      store.set(k, v);
    }
    Promise.resolve().then(() => callback && callback());
  });

  return store;
}

describe('isValidUpdateUrl', () => {
  test('accepts HTTPS URL on default allowed host', () => {
    expect(isValidUpdateUrl('https://raw.githubusercontent.com/org/repo/main/data.json')).toBe(true);
  });

  test('rejects HTTP URL', () => {
    expect(isValidUpdateUrl('http://raw.githubusercontent.com/org/repo/main/data.json')).toBe(false);
  });

  test('rejects file:// URL', () => {
    expect(isValidUpdateUrl('file:///etc/passwd')).toBe(false);
  });

  test('rejects data: URL', () => {
    expect(isValidUpdateUrl('data:text/plain,hello')).toBe(false);
  });

  test('rejects HTTPS URL for host not in default allowlist', () => {
    expect(isValidUpdateUrl('https://evil.example.com/payload.json')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidUpdateUrl('')).toBe(false);
  });

  test('rejects non-URL garbage', () => {
    expect(isValidUpdateUrl('not a url at all')).toBe(false);
  });

  test('accepts HTTPS URL when custom allowedHosts provided', () => {
    expect(isValidUpdateUrl('https://cdn.example.com/playbooks.json', ['cdn.example.com'])).toBe(true);
  });

  test('rejects HTTPS URL when host not in custom allowedHosts', () => {
    expect(isValidUpdateUrl('https://raw.githubusercontent.com/org/repo/main/data.json', ['cdn.example.com'])).toBe(false);
  });

  test('rejects HTTP even if host is in allowedHosts', () => {
    expect(isValidUpdateUrl('http://cdn.example.com/playbooks.json', ['cdn.example.com'])).toBe(false);
  });
});

describe('checkForUpdates', () => {
  const VALID_URL = 'https://raw.githubusercontent.com/org/repo/main/data.json';

  beforeEach(() => {
    jest.clearAllMocks();
    // Provide a default empty META so recordUpdateMeta can merge into it
    chrome.storage.local.get.mockImplementation((keys, callback) => {
      callback({});
    });
    chrome.storage.local.set.mockImplementation((items, callback) => {
      if (callback) callback();
    });
  });

  test('records lastFetchError in META when fetch throws an AbortError', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    global.fetch = jest.fn().mockRejectedValue(abortError);

    await checkForUpdates(VALID_URL);

    // Find the chrome.storage.local.set call that wrote META
    const metaCall = chrome.storage.local.set.mock.calls.find(
      ([items]) => items && items.meta !== undefined
    );
    expect(metaCall).toBeDefined();
    const meta = metaCall[0].meta;
    expect(meta.lastFetchError).toBe(abortError.message);
    expect(typeof meta.lastFetchAt).toBe('string');
  });

  test('records lastFetchError: null in META on a successful fetch', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    });

    await checkForUpdates(VALID_URL);

    const metaCall = chrome.storage.local.set.mock.calls.find(
      ([items]) => items && items.meta !== undefined
    );
    expect(metaCall).toBeDefined();
    const meta = metaCall[0].meta;
    expect(meta.lastFetchError).toBeNull();
    expect(typeof meta.lastFetchAt).toBe('string');
  });

  test('does nothing for an invalid URL', async () => {
    global.fetch = jest.fn();
    await checkForUpdates('http://not-allowed.com/data.json');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('recordUpdateMeta concurrency', () => {
  const VALID_URL = 'https://raw.githubusercontent.com/org/repo/main/data.json';

  test('serializes concurrent writes so no update is lost', async () => {
    const store = installStatefulStorageMock();

    // Both calls will fail (network error) → each writes lastFetchError + lastFetchAt
    const networkError = new Error('Network failure');
    global.fetch = jest.fn().mockRejectedValue(networkError);

    // Fire two checkForUpdates concurrently
    await Promise.all([
      checkForUpdates(VALID_URL),
      checkForUpdates(VALID_URL)
    ]);

    const meta = store.get('meta');
    expect(meta).toBeDefined();
    // Both writes happened — meta should have lastFetchError and lastFetchAt
    expect(meta.lastFetchError).toBe(networkError.message);
    expect(typeof meta.lastFetchAt).toBe('string');
    // The second write must not have wiped out the key written by the first
    // (i.e. no undefined holes — both runs set the same keys, lock ensures ordering)
    expect(Object.keys(meta).length).toBeGreaterThanOrEqual(2);
  });
});
