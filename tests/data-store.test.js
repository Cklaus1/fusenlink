/**
 * Tests for data-store: storeData (mergeKey, append, single object),
 * logActivity (append/prune behavior), and concurrency-locking guarantees.
 */

import { storeData, getData, logActivity, deleteData } from '../src/background/data-store.js';
import { storageSet, getStorageStats } from '../src/shared/storage.js';

let _localStore;

function installStorageMock() {
  _localStore = new Map();

  chrome.storage.local.get.mockImplementation((keys, callback) => {
    let out = {};
    if (keys === null || keys === undefined) {
      for (const [k, v] of _localStore.entries()) out[k] = v;
    } else if (typeof keys === 'string') {
      if (_localStore.has(keys)) out[keys] = _localStore.get(keys);
    } else if (Array.isArray(keys)) {
      for (const k of keys) {
        if (_localStore.has(k)) out[k] = _localStore.get(k);
      }
    } else if (typeof keys === 'object') {
      for (const [k, defaultVal] of Object.entries(keys)) {
        out[k] = _localStore.has(k) ? _localStore.get(k) : defaultVal;
      }
    }
    Promise.resolve().then(() => callback(out));
  });

  chrome.storage.local.set.mockImplementation((items, callback) => {
    for (const [k, v] of Object.entries(items)) {
      _localStore.set(k, v);
    }
    Promise.resolve().then(() => callback && callback());
  });

  chrome.storage.local.remove.mockImplementation((keys, callback) => {
    const arr = Array.isArray(keys) ? keys : [keys];
    for (const k of arr) _localStore.delete(k);
    Promise.resolve().then(() => callback && callback());
  });
}

function readStored(key) {
  return _localStore.get(key);
}

beforeEach(() => {
  installStorageMock();
});

describe('storeData with mergeKey', () => {
  test('upserts items by key, multiple writes accumulate', async () => {
    const r1 = await storeData('contacts', [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' }
    ], { mergeKey: 'id' });
    expect(r1.success).toBe(true);
    expect(r1.count).toBe(2);

    const r2 = await storeData('contacts', [
      { id: 'b', name: 'Bobby' }, // update
      { id: 'c', name: 'Carol' }   // insert
    ], { mergeKey: 'id' });
    expect(r2.success).toBe(true);

    const stored = readStored('data.contacts');
    expect(Object.keys(stored.items).sort()).toEqual(['a', 'b', 'c']);
    expect(stored.items.a.name).toBe('Alice');
    expect(stored.items.b.name).toBe('Bobby');
    expect(stored.items.c.name).toBe('Carol');
    // Each merged item gets an updatedAt
    expect(typeof stored.items.b.updatedAt).toBe('string');
  });

  test('skips items missing the mergeKey', async () => {
    await storeData('contacts', [
      { id: 'a', name: 'A' },
      { name: 'NoId' }
    ], { mergeKey: 'id' });

    const stored = readStored('data.contacts');
    expect(Object.keys(stored.items)).toEqual(['a']);
  });

  // Bug 19: storeData with mergeKey must report skipped count for items missing the field
  test('returns count of stored and skipped items when some are missing the mergeKey', async () => {
    const result = await storeData('contacts', [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' },
      { id: 'c', name: 'Carol' },
      { name: 'NoId1' },  // missing id
      { name: 'NoId2' }   // missing id
    ], { mergeKey: 'id' });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(result.skipped).toBe(2);

    const stored = readStored('data.contacts');
    expect(Object.keys(stored.items).sort()).toEqual(['a', 'b', 'c']);
  });

  test('returns skipped: 0 when all items have the mergeKey', async () => {
    const result = await storeData('contacts', [
      { id: 'x', name: 'X' },
      { id: 'y', name: 'Y' }
    ], { mergeKey: 'id' });

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.skipped).toBe(0);
  });
});

describe('storeData appending entries (no mergeKey)', () => {
  test('array data appends to entries; preserves earlier entries', async () => {
    await storeData('outreach', [
      { event: 'sent', target: 'x' }
    ]);
    await storeData('outreach', [
      { event: 'sent', target: 'y' },
      { event: 'sent', target: 'z' }
    ]);

    const stored = readStored('data.outreach');
    expect(stored.entries).toHaveLength(3);
    expect(stored.entries.map(e => e.target)).toEqual(['x', 'y', 'z']);
    // Each entry got a timestamp
    expect(stored.entries[0].timestamp).toBeDefined();
  });

  test('preserves caller-supplied timestamp when provided', async () => {
    const ts = '2020-01-01T00:00:00.000Z';
    await storeData('outreach', [{ event: 'sent', timestamp: ts }]);
    const stored = readStored('data.outreach');
    expect(stored.entries[0].timestamp).toBe(ts);
  });
});

describe('storeData single object', () => {
  test('stores a non-array under data key', async () => {
    const r = await storeData('inbox', { totalUnread: 5, lastScan: 'now' });
    expect(r.success).toBe(true);
    expect(r.count).toBe(1);
    const stored = readStored('data.inbox');
    expect(stored.data).toEqual({ totalUnread: 5, lastScan: 'now' });
    expect(stored.updatedAt).toBeDefined();
  });
});

describe('storeData with unknown collection', () => {
  test('returns success: false and does not write', async () => {
    const r = await storeData('not-a-real-collection', { x: 1 });
    expect(r.success).toBe(false);
    expect(_localStore.size).toBe(0);
  });
});

describe('logActivity append + prune', () => {
  test('appends entries with id and timestamp', async () => {
    await logActivity({ playbookId: 'foo', action: 'click', outcome: 'ok' });
    await logActivity({ playbookId: 'foo', action: 'wait', outcome: 'ok' });

    const stored = readStored('data.activityLog');
    expect(stored.entries).toHaveLength(2);
    expect(stored.entries[0].playbookId).toBe('foo');
    expect(stored.entries[0].id).toBeDefined();
    expect(stored.entries[0].timestamp).toBeDefined();
    expect(stored._writeCount).toBe(2);
  });

  test('prunes lazily on every 50th write', async () => {
    // Write 50 entries — at write #50, _writeCount % 50 === 0, so prune runs.
    // Since none are stale and length < 1100, prune is a no-op and entries
    // remain at 50. The point of this test: verify the prune branch was hit
    // (no exception, _writeCount === 50, entries === 50).
    for (let i = 0; i < 50; i++) {
      await logActivity({ playbookId: 'p', action: `a${i}`, outcome: 'ok' });
    }

    const stored = readStored('data.activityLog');
    expect(stored._writeCount).toBe(50);
    expect(stored.entries).toHaveLength(50);
  });

  test('prunes entries older than 30 days when prune triggers', async () => {
    // Pre-seed with a mix of old and recent entries, plus _writeCount=49 so
    // that the next write triggers the prune branch (write count becomes 50).
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    const seedEntries = [];
    for (let i = 0; i < 5; i++) {
      seedEntries.push({ id: `old${i}`, timestamp: fortyDaysAgo, playbookId: 'p', action: 'a' });
    }
    for (let i = 0; i < 5; i++) {
      seedEntries.push({ id: `new${i}`, timestamp: fiveDaysAgo, playbookId: 'p', action: 'a' });
    }
    _localStore.set('data.activityLog', {
      entries: seedEntries,
      _writeCount: 49
    });

    await logActivity({ playbookId: 'p', action: 'trigger-prune', outcome: 'ok' });

    const stored = readStored('data.activityLog');
    // The 5 entries from 40 days ago should be gone; the 5 recent + 1 new should remain.
    const ids = stored.entries.map(e => e.id);
    expect(ids.some(id => id && id.startsWith('old'))).toBe(false);
    // 5 recent + 1 new entry just added
    expect(stored.entries).toHaveLength(6);
  });

  test('prunes when entries balloon past 1100 even before write #50', async () => {
    // Pre-seed with 1100+ recent entries so the length-based prune condition fires.
    const recent = new Date().toISOString();
    const seedEntries = [];
    for (let i = 0; i < 1101; i++) {
      seedEntries.push({ id: `e${i}`, timestamp: recent, playbookId: 'p', action: 'a' });
    }
    _localStore.set('data.activityLog', {
      entries: seedEntries,
      _writeCount: 1 // not divisible by 50
    });

    await logActivity({ playbookId: 'p', action: 'trigger', outcome: 'ok' });

    const stored = readStored('data.activityLog');
    // Length-based slice cap is 1000
    expect(stored.entries.length).toBeLessThanOrEqual(1000);
    expect(stored.entries.length).toBe(1000);
  });
});

describe('Concurrent logActivity (lock guarantee)', () => {
  test('20 parallel calls all land — no lost updates', async () => {
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(logActivity({ playbookId: 'p', action: `a${i}`, outcome: 'ok' }));
    }
    await Promise.all(promises);
    const stored = readStored('data.activityLog');
    expect(stored.entries).toHaveLength(20);
    // Each entry should have a unique id, confirming no overwrite races
    const ids = new Set(stored.entries.map(e => e.id));
    expect(ids.size).toBe(20);
  });
});

describe('Concurrent storeData on different collections', () => {
  test('writes to different collections do not interfere', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(storeData('contacts', [
        { id: `c${i}`, name: `Contact ${i}` }
      ], { mergeKey: 'id' }));
      promises.push(storeData('inbox', [
        { event: 'msg', target: `t${i}` }
      ]));
    }
    await Promise.all(promises);

    const contacts = readStored('data.contacts');
    const inbox = readStored('data.inbox');
    expect(Object.keys(contacts.items)).toHaveLength(10);
    expect(inbox.entries).toHaveLength(10);
  });

  test('parallel writes to same collection do not lose data (locked)', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(storeData('contacts', [
        { id: `c${i}`, name: `C${i}` }
      ], { mergeKey: 'id' }));
    }
    await Promise.all(promises);

    const contacts = readStored('data.contacts');
    expect(Object.keys(contacts.items)).toHaveLength(10);
  });
});

describe('getData and deleteData', () => {
  test('getData returns stored data', async () => {
    await storeData('contacts', [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' }
    ], { mergeKey: 'id' });

    const out = await getData('contacts');
    expect(Object.keys(out.items).sort()).toEqual(['a', 'b']);
  });

  test('getData with limit caps items', async () => {
    await storeData('contacts', [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' }
    ], { mergeKey: 'id' });

    const out = await getData('contacts', { limit: 2 });
    expect(Object.keys(out.items)).toHaveLength(2);
  });

  test('getData with csv format produces csv string', async () => {
    await storeData('contacts', [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' }
    ], { mergeKey: 'id' });

    const out = await getData('contacts', { format: 'csv' });
    expect(typeof out.csv).toBe('string');
    expect(out.csv).toMatch(/Alice/);
    expect(out.csv).toMatch(/Bob/);
  });

  // Bug 29: csv header should be the union of all rows' keys, not just the
  // first row's keys. Schema drift between writes used to silently drop
  // columns introduced in later items.
  test('itemsToCsv (via getData csv format) produces union header for heterogeneous items', async () => {
    // First write: only id + name
    await storeData('contacts', [
      { id: 'a', name: 'Alice' }
    ], { mergeKey: 'id' });
    // Second write: introduces a new column "company"
    await storeData('contacts', [
      { id: 'b', name: 'Bob', company: 'Acme' }
    ], { mergeKey: 'id' });
    // Third write: introduces yet another column "tag"
    await storeData('contacts', [
      { id: 'c', name: 'Carol', tag: 'vip' }
    ], { mergeKey: 'id' });

    const out = await getData('contacts', { format: 'csv' });
    const headerLine = out.csv.split('\n')[0];
    // Union header must include every column from every row.
    expect(headerLine).toContain('id');
    expect(headerLine).toContain('name');
    expect(headerLine).toContain('company');
    expect(headerLine).toContain('tag');
    // The body should still have all 3 rows.
    expect(out.csv.split('\n')).toHaveLength(4); // header + 3 rows
    // Acme should land in the company column
    expect(out.csv).toMatch(/Acme/);
    expect(out.csv).toMatch(/vip/);
  });

  test('getData("activityLog") strips internal _writeCount field', async () => {
    // Several writes will set _writeCount on the underlying record.
    for (let i = 0; i < 3; i++) {
      await logActivity({ playbookId: 'p', action: `a${i}`, outcome: 'ok' });
    }
    // Sanity: the raw stored record still has _writeCount.
    expect(readStored('data.activityLog')._writeCount).toBe(3);

    // No options.
    const out1 = await getData('activityLog');
    expect(out1.entries).toHaveLength(3);
    expect(out1._writeCount).toBeUndefined();

    // With limit (clone path).
    const out2 = await getData('activityLog', { limit: 2 });
    expect(out2.entries).toHaveLength(2);
    expect(out2._writeCount).toBeUndefined();

    // The strip must NOT have mutated the underlying cache.
    expect(readStored('data.activityLog')._writeCount).toBe(3);
  });

  test('deleteData removes the collection', async () => {
    await storeData('contacts', [{ id: 'a', name: 'A' }], { mergeKey: 'id' });
    expect(readStored('data.contacts')).toBeDefined();

    const r = await deleteData('contacts');
    expect(r.success).toBe(true);
    expect(readStored('data.contacts')).toBeUndefined();
  });
});

// Bug 12: storage.js storageSet now triggers a throttled quota check that
// writes a 'meta.quota' warning entry when usage > 80% of the 10MB local
// quota. Verify the warning lands when getBytesInUse reports 9MB.
describe('storage.js quota warning (Bug 12)', () => {
  beforeEach(() => {
    // Reset the throttle by clearing any stored 'meta.quota' first.
    // The throttle is module-scoped, so we use a fresh fake-timer setup.
    if (chrome.storage.local.getBytesInUse) {
      chrome.storage.local.getBytesInUse.mockReset?.();
    }
  });

  test('writes meta.quota when getBytesInUse reports > 80% of 10MB', async () => {
    // 9MB out of 10MB → ratio 0.9, above 0.8 threshold
    const NINE_MB = 9 * 1024 * 1024;
    chrome.storage.local.getBytesInUse = jest.fn((keysOrCb, maybeCb) => {
      const cb = typeof keysOrCb === 'function' ? keysOrCb : maybeCb;
      Promise.resolve().then(() => cb(NINE_MB));
    });

    // Trigger storageSet which (after success) fires maybeCheckQuota.
    await storageSet({ 'data.contacts': { items: { a: { name: 'Alice' } } } });

    // Yield a tick so the async getBytesInUse callback can fire.
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    const meta = readStored('meta.quota');
    expect(meta).toBeDefined();
    expect(meta.bytes).toBe(NINE_MB);
    expect(meta.ratio).toBeCloseTo(0.9, 5);
    expect(meta.limit).toBe(10 * 1024 * 1024);
    expect(typeof meta.lastChecked).toBe('string');
  });

  test('getStorageStats returns current usage stats', async () => {
    const FOUR_MB = 4 * 1024 * 1024;
    chrome.storage.local.getBytesInUse = jest.fn((keysOrCb, maybeCb) => {
      const cb = typeof keysOrCb === 'function' ? keysOrCb : maybeCb;
      Promise.resolve().then(() => cb(FOUR_MB));
    });

    const stats = await getStorageStats();
    expect(stats).not.toBeNull();
    expect(stats.bytes).toBe(FOUR_MB);
    expect(stats.limit).toBe(10 * 1024 * 1024);
    expect(stats.ratio).toBeCloseTo(0.4, 5);
  });
});
