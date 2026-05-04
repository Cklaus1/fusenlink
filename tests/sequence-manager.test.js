/**
 * Tests for sequence-manager: sequence CRUD, enrollment, message recording,
 * reply marking, processing, and crucially the concurrency-locking guarantee.
 *
 * The jest-chrome `chrome.storage.local` mock is just `jest.fn()` stubs with
 * no actual persistence, so we wire a backing Map and stub get/set/remove
 * to behave like the real chrome.storage.local API (callback-based, async).
 */

import {
  createSequence,
  enrollContacts,
  markReplied,
  recordMessageSent,
  processSequences,
  getSequences,
  getSequence,
  deleteSequence,
  setSequenceStatus
} from '../src/background/sequence-manager.js';

// Backing in-memory storage. Wired in beforeEach.
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
      // Object form: defaults
      for (const [k, defaultVal] of Object.entries(keys)) {
        out[k] = _localStore.has(k) ? _localStore.get(k) : defaultVal;
      }
    }
    // Async-style: queue the callback so it runs after current microtask.
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
  // Avoid "process" pollution by stubbing alarms/notifications too if used.
  if (chrome.alarms?.create) chrome.alarms.create.mockImplementation(() => {});
  if (chrome.alarms?.clear) chrome.alarms.clear.mockImplementation(() => {});
});

describe('createSequence', () => {
  test('creates a sequence with id seq_*, default empty contacts, zeroed stats', async () => {
    const seq = await createSequence({
      name: 'Test campaign',
      steps: [{ template: 'Hi {name}!' }, { template: 'Following up' }]
    });

    expect(seq.id).toMatch(/^seq_/);
    expect(seq.name).toBe('Test campaign');
    expect(seq.contacts).toEqual({});
    expect(seq.stats).toEqual({ enrolled: 0, sent: 0, replied: 0, completed: 0 });
    expect(seq.status).toBe('active');
    expect(seq.steps).toHaveLength(2);
    // Step indices are normalized
    expect(seq.steps[0].index).toBe(0);
    expect(seq.steps[1].index).toBe(1);
    // First step defaults to 0 days delay, subsequent default to 3
    expect(seq.steps[0].delayDays).toBe(0);
    expect(seq.steps[1].delayDays).toBe(3);
  });

  test('persists sequence to chrome.storage.local under data.sequences', async () => {
    const seq = await createSequence({ name: 'A', steps: [{ template: 'x' }] });
    const stored = readStored('data.sequences');
    expect(stored).toBeDefined();
    expect(stored.items[seq.id]).toBeDefined();
    expect(stored.items[seq.id].name).toBe('A');
  });
});

describe('enrollContacts', () => {
  test('enrolls N contacts with currentStep=0, status=active, nextMessageAt=~now', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }] });
    const before = Date.now();
    const result = await enrollContacts(seq.id, [
      { name: 'Alice', profileUrl: 'https://www.linkedin.com/in/alice/' },
      { name: 'Bob', profileUrl: 'https://www.linkedin.com/in/bob/' }
    ]);
    const after = Date.now();

    expect(result.enrolled).toBe(2);
    const stored = readStored('data.sequences').items[seq.id];
    expect(Object.keys(stored.contacts)).toHaveLength(2);
    const alice = stored.contacts['https://www.linkedin.com/in/alice/'];
    expect(alice.currentStep).toBe(0);
    expect(alice.status).toBe('active');
    expect(alice.name).toBe('Alice');
    const t = new Date(alice.nextMessageAt).getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after + 5);
    expect(stored.stats.enrolled).toBe(2);
  });

  test('deduplicates: enrolling same profileUrl twice does not double-enroll', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }] });
    await enrollContacts(seq.id, [
      { name: 'Alice', profileUrl: 'https://www.linkedin.com/in/alice/' }
    ]);
    const result = await enrollContacts(seq.id, [
      { name: 'Alice DUPE', profileUrl: 'https://www.linkedin.com/in/alice/' }
    ]);
    expect(result.enrolled).toBe(0);

    const stored = readStored('data.sequences').items[seq.id];
    expect(Object.keys(stored.contacts)).toHaveLength(1);
    // Original name preserved (not overwritten)
    expect(stored.contacts['https://www.linkedin.com/in/alice/'].name).toBe('Alice');
    expect(stored.stats.enrolled).toBe(1);
  });

  test('throws on unknown sequenceId', async () => {
    await expect(enrollContacts('seq_does_not_exist', [
      { profileUrl: 'https://www.linkedin.com/in/x/' }
    ])).rejects.toThrow(/not found/);
  });

  test('skips contacts without profileUrl', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }] });
    const r = await enrollContacts(seq.id, [
      { name: 'NoUrl' },
      { name: 'Has', profileUrl: 'https://www.linkedin.com/in/has/' }
    ]);
    expect(r.enrolled).toBe(1);
  });
});

describe('markReplied', () => {
  test('idempotent: calling twice for same contact only increments stats.replied once', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }] });
    const url = 'https://www.linkedin.com/in/alice/';
    await enrollContacts(seq.id, [{ name: 'Alice', profileUrl: url }]);

    await markReplied(seq.id, url);
    await markReplied(seq.id, url); // second call should be a no-op

    const stored = readStored('data.sequences').items[seq.id];
    expect(stored.contacts[url].status).toBe('replied');
    expect(stored.stats.replied).toBe(1);
  });

  test('gated by status: a "completed" contact cannot be flipped to "replied"', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }] });
    const url = 'https://www.linkedin.com/in/alice/';
    await enrollContacts(seq.id, [{ name: 'Alice', profileUrl: url }]);

    // Force-set status=completed by directly manipulating the storage backing.
    const data = readStored('data.sequences');
    data.items[seq.id].contacts[url].status = 'completed';
    _localStore.set('data.sequences', data);

    await markReplied(seq.id, url);

    const after = readStored('data.sequences').items[seq.id];
    expect(after.contacts[url].status).toBe('completed');
    expect(after.stats.replied).toBe(0);
  });

  test('no-op when sequence or contact not found', async () => {
    await markReplied('seq_does_not_exist', 'https://www.linkedin.com/in/x/');
    // Should not throw and should not have created anything
    expect(readStored('data.sequences')).toBeUndefined();
  });
});

describe('recordMessageSent', () => {
  test('pushes message, sets lastMessageAt, advances step, schedules next', async () => {
    const seq = await createSequence({
      name: 'C',
      steps: [
        { template: 'first' },
        { template: 'second', delayDays: 5 }
      ]
    });
    const url = 'https://www.linkedin.com/in/alice/';
    await enrollContacts(seq.id, [{ name: 'Alice', profileUrl: url }]);

    const before = Date.now();
    await recordMessageSent(seq.id, url, 'Hello Alice!');
    const after = Date.now();

    const c = readStored('data.sequences').items[seq.id].contacts[url];
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0].text).toBe('Hello Alice!');
    expect(c.messages[0].step).toBe(0);
    expect(c.currentStep).toBe(1);
    expect(c.status).toBe('active'); // not last step
    expect(typeof c.lastMessageAt).toBe('string');

    // nextMessageAt should be ~5 days in the future (next step's delayDays)
    const nextT = new Date(c.nextMessageAt).getTime();
    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
    expect(nextT).toBeGreaterThanOrEqual(before + fiveDaysMs - 1000);
    expect(nextT).toBeLessThanOrEqual(after + fiveDaysMs + 1000);

    expect(readStored('data.sequences').items[seq.id].stats.sent).toBe(1);
  });

  test('on final step marks contact completed and bumps stats.completed', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 'only' }] });
    const url = 'https://www.linkedin.com/in/alice/';
    await enrollContacts(seq.id, [{ name: 'Alice', profileUrl: url }]);

    await recordMessageSent(seq.id, url, 'final msg');
    const stored = readStored('data.sequences').items[seq.id];
    expect(stored.contacts[url].currentStep).toBe(1);
    expect(stored.contacts[url].status).toBe('completed');
    expect(stored.stats.sent).toBe(1);
    expect(stored.stats.completed).toBe(1);
  });

  test('no-op when contact not found', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }] });
    await recordMessageSent(seq.id, 'https://www.linkedin.com/in/nobody/', 'x');
    const stored = readStored('data.sequences').items[seq.id];
    expect(stored.stats.sent).toBe(0);
  });
});

describe('processSequences', () => {
  test('returns ready messages without mutating stored state', async () => {
    const seq = await createSequence({
      name: 'C',
      steps: [{ template: 'Hello {name}!' }]
    });
    const url = 'https://www.linkedin.com/in/alice/';
    await enrollContacts(seq.id, [{ name: 'Alice', profileUrl: url }]);

    const beforeSnapshot = JSON.parse(JSON.stringify(readStored('data.sequences')));

    const ready = await processSequences();

    expect(ready).toHaveLength(1);
    expect(ready[0].sequenceId).toBe(seq.id);
    expect(ready[0].profileUrl).toBe(url);
    expect(ready[0].messageText).toBe('Hello Alice!'); // template var replaced
    expect(ready[0].step).toBe(0);

    // Stored state should be unchanged (other than possibly stats.completed
    // updates from reapCompletedContacts, but no completion should have happened).
    const afterSnapshot = readStored('data.sequences');
    expect(afterSnapshot).toEqual(beforeSnapshot);
  });

  test('excludes contacts not yet due', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }] });
    const url = 'https://www.linkedin.com/in/future/';
    await enrollContacts(seq.id, [{ name: 'Future', profileUrl: url }]);

    // Force nextMessageAt into the future
    const data = readStored('data.sequences');
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    data.items[seq.id].contacts[url].nextMessageAt = future;
    _localStore.set('data.sequences', data);

    const ready = await processSequences();
    expect(ready).toHaveLength(0);
  });

  test('reaps overrun contacts (currentStep >= steps.length, status=active) to completed', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }] });
    const url = 'https://www.linkedin.com/in/over/';
    await enrollContacts(seq.id, [{ name: 'Over', profileUrl: url }]);

    // Simulate an overrun: currentStep past end but still active
    const data = readStored('data.sequences');
    data.items[seq.id].contacts[url].currentStep = 5;
    data.items[seq.id].contacts[url].status = 'active';
    _localStore.set('data.sequences', data);

    const ready = await processSequences();
    expect(ready).toHaveLength(0);

    const after = readStored('data.sequences').items[seq.id];
    expect(after.contacts[url].status).toBe('completed');
    expect(after.stats.completed).toBe(1);
  });

  test('excludes contacts with non-active status', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }] });
    const url = 'https://www.linkedin.com/in/replied/';
    await enrollContacts(seq.id, [{ name: 'Replied', profileUrl: url }]);

    const data = readStored('data.sequences');
    data.items[seq.id].contacts[url].status = 'replied';
    _localStore.set('data.sequences', data);

    const ready = await processSequences();
    expect(ready).toHaveLength(0);
  });

  test('skips paused sequences entirely', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }] });
    const url = 'https://www.linkedin.com/in/alice/';
    await enrollContacts(seq.id, [{ name: 'Alice', profileUrl: url }]);

    await setSequenceStatus(seq.id, 'paused');

    const ready = await processSequences();
    expect(ready).toHaveLength(0);
  });
});

describe('Concurrent markReplied + recordMessageSent (lock guarantee)', () => {
  test('both writes are visible: messages.length === 1 AND status === "replied"', async () => {
    const seq = await createSequence({
      name: 'C',
      steps: [{ template: 'first' }, { template: 'second' }]
    });
    const url = 'https://www.linkedin.com/in/alice/';
    await enrollContacts(seq.id, [{ name: 'Alice', profileUrl: url }]);

    // Fire both without awaiting individually
    const p1 = recordMessageSent(seq.id, url, 'Hello!');
    const p2 = markReplied(seq.id, url);
    await Promise.all([p1, p2]);

    const c = readStored('data.sequences').items[seq.id].contacts[url];

    // Both writes must be visible. The lock serializes them; whichever ran
    // first didn't get clobbered by the second.
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0].text).toBe('Hello!');

    // The interleavings allowed by the lock:
    //   (a) recordMessageSent first → currentStep=1, status='active' (still
    //       active because there's a second step). Then markReplied runs,
    //       sees status='active', flips to 'replied'.
    //   (b) markReplied first → status='replied'. Then recordMessageSent
    //       runs unconditionally (it does NOT check status), pushes message,
    //       advances step to 1.
    // Either way: messages.length === 1 AND status === 'replied'.
    expect(c.status).toBe('replied');
    expect(c.currentStep).toBe(1);

    // stats.replied incremented exactly once
    expect(readStored('data.sequences').items[seq.id].stats.replied).toBe(1);
    expect(readStored('data.sequences').items[seq.id].stats.sent).toBe(1);
  });

  test('many concurrent enrollments do not lose contacts', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }] });
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(enrollContacts(seq.id, [
        { name: `User${i}`, profileUrl: `https://www.linkedin.com/in/user${i}/` }
      ]));
    }
    await Promise.all(promises);
    const stored = readStored('data.sequences').items[seq.id];
    expect(Object.keys(stored.contacts)).toHaveLength(10);
    expect(stored.stats.enrolled).toBe(10);
  });
});

describe('deleteSequence and setSequenceStatus', () => {
  test('deleteSequence removes the sequence', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }] });
    expect(readStored('data.sequences').items[seq.id]).toBeDefined();
    await deleteSequence(seq.id);
    expect(readStored('data.sequences').items[seq.id]).toBeUndefined();
  });

  test('setSequenceStatus updates status', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }] });
    await setSequenceStatus(seq.id, 'paused');
    expect(readStored('data.sequences').items[seq.id].status).toBe('paused');

    const fetched = await getSequence(seq.id);
    expect(fetched.status).toBe('paused');
  });
});

describe('getSequences default', () => {
  test('returns { items: {} } when nothing stored', async () => {
    const s = await getSequences();
    expect(s).toEqual({ items: {} });
  });
});
