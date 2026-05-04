/**
 * Tests for sequence-manager: sequence CRUD, enrollment, message recording,
 * reply marking, processing, and crucially the concurrency-locking guarantee.
 *
 * The jest-chrome `chrome.storage.local` mock is just `jest.fn()` stubs with
 * no actual persistence, so we wire a backing Map and stub get/set/remove
 * to behave like the real chrome.storage.local API (callback-based, async).
 */

import * as SequenceManager from '../src/background/sequence-manager.js';
import {
  createSequence,
  enrollContacts,
  markReplied,
  recordMessageSent,
  processSequences,
  getSequences,
  getSequence,
  deleteSequence,
  setSequenceStatus,
  nextSendableTime,
  reapCompletedContacts,
  restagger
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
  // Disable quiet hours for these tests so nextMessageAt is not shifted
  // forward into the next business day (which is exercised separately).
  const noQuiet = { staggerMinutes: 0, quietHoursStart: 0, quietHoursEnd: 24, weekdaysOnly: false };

  test('enrolls N contacts with currentStep=0, status=active, nextMessageAt=~now', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }], settings: noQuiet });
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
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }], settings: noQuiet });
    await enrollContacts(seq.id, [
      { name: 'Alice', profileUrl: 'https://www.linkedin.com/in/alice/' }
    ]);
    const result = await enrollContacts(seq.id, [
      { name: 'Alice DUPE', profileUrl: 'https://www.linkedin.com/in/alice/' }
    ]);
    expect(result.enrolled).toBe(0);
    expect(result.skipped).toEqual([
      { reason: 'duplicate', profileUrl: 'https://www.linkedin.com/in/alice/' }
    ]);

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
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }], settings: noQuiet });
    const r = await enrollContacts(seq.id, [
      { name: 'NoUrl' },
      { name: 'Has', profileUrl: 'https://www.linkedin.com/in/has/' }
    ]);
    expect(r.enrolled).toBe(1);
  });
});

describe('markReplied', () => {
  // Tests in this and subsequent describe blocks don't care about exact send
  // times — disable quiet-hours/staggering so behavior is deterministic.
  const noQuiet = { staggerMinutes: 0, quietHoursStart: 0, quietHoursEnd: 24, weekdaysOnly: false };

  test('idempotent: calling twice for same contact only increments stats.replied once', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }], settings: noQuiet });
    const url = 'https://www.linkedin.com/in/alice/';
    await enrollContacts(seq.id, [{ name: 'Alice', profileUrl: url }]);

    await markReplied(seq.id, url);
    await markReplied(seq.id, url); // second call should be a no-op

    const stored = readStored('data.sequences').items[seq.id];
    expect(stored.contacts[url].status).toBe('replied');
    expect(stored.stats.replied).toBe(1);
  });

  test('gated by status: a "completed" contact cannot be flipped to "replied"', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }], settings: noQuiet });
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
  const noQuiet = { staggerMinutes: 0, quietHoursStart: 0, quietHoursEnd: 24, weekdaysOnly: false };

  test('pushes message, sets lastMessageAt, advances step, schedules next', async () => {
    const seq = await createSequence({
      name: 'C',
      steps: [
        { template: 'first' },
        { template: 'second', delayDays: 5 }
      ],
      settings: noQuiet
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
    const seq = await createSequence({ name: 'C', steps: [{ template: 'only' }], settings: noQuiet });
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
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }], settings: noQuiet });
    await recordMessageSent(seq.id, 'https://www.linkedin.com/in/nobody/', 'x');
    const stored = readStored('data.sequences').items[seq.id];
    expect(stored.stats.sent).toBe(0);
  });
});

describe('processSequences', () => {
  const noQuiet = { staggerMinutes: 0, quietHoursStart: 0, quietHoursEnd: 24, weekdaysOnly: false };

  test('returns ready messages without mutating stored state', async () => {
    const seq = await createSequence({
      name: 'C',
      steps: [{ template: 'Hello {name}!' }],
      settings: noQuiet
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
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }], settings: noQuiet });
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
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }], settings: noQuiet });
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
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }], settings: noQuiet });
    const url = 'https://www.linkedin.com/in/replied/';
    await enrollContacts(seq.id, [{ name: 'Replied', profileUrl: url }]);

    const data = readStored('data.sequences');
    data.items[seq.id].contacts[url].status = 'replied';
    _localStore.set('data.sequences', data);

    const ready = await processSequences();
    expect(ready).toHaveLength(0);
  });

  test('skips paused sequences entirely', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }], settings: noQuiet });
    const url = 'https://www.linkedin.com/in/alice/';
    await enrollContacts(seq.id, [{ name: 'Alice', profileUrl: url }]);

    await setSequenceStatus(seq.id, 'paused');

    const ready = await processSequences();
    expect(ready).toHaveLength(0);
  });
});

describe('Concurrent markReplied + recordMessageSent (lock guarantee)', () => {
  const noQuiet = { staggerMinutes: 0, quietHoursStart: 0, quietHoursEnd: 24, weekdaysOnly: false };

  test('both writes are visible: messages.length === 1 AND status === "replied"', async () => {
    const seq = await createSequence({
      name: 'C',
      steps: [{ template: 'first' }, { template: 'second' }],
      settings: noQuiet
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
    //       (Bug 27) sees status !== 'active' and is a no-op — no message
    //       pushed, no step advanced.
    // The lock chain in withLock(fn) preserves submission order: p1 was
    // scheduled first, so branch (a) is the deterministic outcome here.
    // Either way: status === 'replied' is preserved.
    expect(c.status).toBe('replied');
    expect(c.currentStep).toBe(1);

    // stats.replied incremented exactly once
    expect(readStored('data.sequences').items[seq.id].stats.replied).toBe(1);
    expect(readStored('data.sequences').items[seq.id].stats.sent).toBe(1);
  });

  test('many concurrent enrollments do not lose contacts', async () => {
    const seq = await createSequence({ name: 'C', steps: [{ template: 't' }], settings: noQuiet });
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

// --- New behavior: staggering, business hours, defensive copy, error report, DST ---

describe('enrollContacts staggering + quiet hours', () => {
  // Bug 2/3: quiet-hours are evaluated in `sequence.settings.timezone`
  // (default UTC). These tests want host-local semantics, so they pin the
  // timezone explicitly to the host's IANA TZ. They also disable
  // weekdaysOnly so a "today" landing on a weekend doesn't shift the result.
  const HOST_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function localTimeAt(hour, dayOffset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    // Skip weekends so "next day" math stays inside Mon-Fri.
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() + 1);
    }
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  test('50 enrollments at 9am: nextMessageAt staggered 5min apart, all within business hours', async () => {
    // 9:00am local — well inside default 8..20 window.
    const nineAm = localTimeAt(9);
    jest.useFakeTimers({ now: nineAm, doNotFake: ['queueMicrotask'] });

    const seq = await createSequence({
      name: 'Big',
      steps: [{ template: 't' }],
      // Pin TZ to host so getHours()-based assertions match.
      // Bug 3: default staggerMinutes is now 1; this test explicitly opts
      // back to 5 to exercise the multi-minute spacing math.
      settings: { timezone: HOST_TZ, weekdaysOnly: false, staggerMinutes: 5 }
    });

    const contacts = Array.from({ length: 50 }, (_, i) => ({
      name: `User${i}`,
      profileUrl: `https://www.linkedin.com/in/user${i}/`
    }));
    const result = await enrollContacts(seq.id, contacts);
    expect(result.enrolled).toBe(50);

    const stored = readStored('data.sequences').items[seq.id];
    const times = contacts.map(c => new Date(stored.contacts[c.profileUrl].nextMessageAt).getTime());

    // First contact at 9:00am, last at 9:00 + 49*5min = 13:05 — still within 8..20.
    expect(times[0]).toBe(nineAm);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBe(5 * 60 * 1000);
      // Each should still be within local business hours (8..20).
      const hr = new Date(times[i]).getHours();
      expect(hr).toBeGreaterThanOrEqual(8);
      expect(hr).toBeLessThan(20);
    }
  });

  test('1 enrollment at 11pm shifts nextMessageAt to 8am next day', async () => {
    const elevenPm = localTimeAt(23); // 23:00 local on a weekday
    jest.useFakeTimers({ now: elevenPm, doNotFake: ['queueMicrotask'] });

    const seq = await createSequence({
      name: 'Late',
      steps: [{ template: 't' }],
      settings: { timezone: HOST_TZ, weekdaysOnly: false }
    });
    await enrollContacts(seq.id, [
      { name: 'Late', profileUrl: 'https://www.linkedin.com/in/late/' }
    ]);

    const stored = readStored('data.sequences').items[seq.id];
    const t = new Date(stored.contacts['https://www.linkedin.com/in/late/'].nextMessageAt);
    expect(t.getHours()).toBe(8);
    expect(t.getMinutes()).toBe(0);

    // Should be the next local day.
    const expected = new Date(elevenPm);
    expected.setDate(expected.getDate() + 1);
    expected.setHours(8, 0, 0, 0);
    expect(t.getTime()).toBe(expected.getTime());
  });
});

describe('enrollContacts error report (Bug 28)', () => {
  test('5 valid + 2 missing profileUrl returns enrolled:5 and 2 missing_profileUrl skipped', async () => {
    const seq = await createSequence({
      name: 'Mixed',
      steps: [{ template: 't' }],
      settings: { staggerMinutes: 0, quietHoursStart: 0, quietHoursEnd: 24, weekdaysOnly: false }
    });

    const contacts = [
      { name: 'Alice', profileUrl: 'https://www.linkedin.com/in/alice/' },
      { name: 'NoUrl1' },
      { name: 'Bob', profileUrl: 'https://www.linkedin.com/in/bob/' },
      { name: 'NoUrl2' },
      { name: 'Carol', profileUrl: 'https://www.linkedin.com/in/carol/' },
      { name: 'Dan', profileUrl: 'https://www.linkedin.com/in/dan/' },
      { name: 'Eve', profileUrl: 'https://www.linkedin.com/in/eve/' }
    ];
    const result = await enrollContacts(seq.id, contacts);

    expect(result.enrolled).toBe(5);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.every(s => s.reason === 'missing_profileUrl')).toBe(true);
    // Each skipped row preserves the original contact for diagnostics.
    expect(result.skipped[0].contact).toEqual({ name: 'NoUrl1' });
    expect(result.skipped[1].contact).toEqual({ name: 'NoUrl2' });
  });
});

describe('recordMessageSent DST-safe arithmetic (Bug 18)', () => {
  // The implementation now uses absolute ms arithmetic, so a 7-day delay must
  // produce exactly +7*86400*1000 ms (modulo any subsequent quiet-hours shift).
  // setDate(getDate()+N) would silently skip/duplicate an hour at DST.
  afterEach(() => {
    jest.useRealTimers();
  });

  test('delayDays:7 across DST fall-back produces a time within 1h of +7 days', async () => {
    // Anchor at 4am local on a day chosen for the DST transition month.
    // We don't depend on actual DST; we depend on the implementation using
    // ms arithmetic — which produces an exact +7d offset regardless of TZ.
    const anchor = new Date();
    anchor.setMonth(10); // November (0-indexed)
    anchor.setDate(2);   // 2nd — common US DST fall-back day
    anchor.setHours(4, 0, 0, 0);
    const nowMs = anchor.getTime();
    jest.useFakeTimers({ now: nowMs, doNotFake: ['queueMicrotask'] });

    // Disable quiet-hours so the +7d candidate isn't shifted.
    const seq = await createSequence({
      name: 'DST',
      steps: [
        { template: 'first' },
        { template: 'second', delayDays: 7 }
      ],
      settings: { staggerMinutes: 0, quietHoursStart: 0, quietHoursEnd: 24, weekdaysOnly: false }
    });
    const url = 'https://www.linkedin.com/in/dst/';
    await enrollContacts(seq.id, [{ name: 'D', profileUrl: url }]);

    await recordMessageSent(seq.id, url, 'first msg');

    const c = readStored('data.sequences').items[seq.id].contacts[url];
    const next = new Date(c.nextMessageAt).getTime();
    const expected = nowMs + 7 * 86400 * 1000;
    // Allow up to 1h tolerance per the spec.
    expect(Math.abs(next - expected)).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});

describe('processSequences defensive deep copy (Bug 3)', () => {
  test('caller mutating returned contact.messages does not corrupt storage', async () => {
    const seq = await createSequence({
      name: 'C',
      steps: [{ template: 'hi' }],
      settings: { staggerMinutes: 0, quietHoursStart: 0, quietHoursEnd: 24, weekdaysOnly: false }
    });
    const url = 'https://www.linkedin.com/in/m/';
    await enrollContacts(seq.id, [{ name: 'M', profileUrl: url }]);

    const ready = await processSequences();
    expect(ready).toHaveLength(1);

    // Mutate the returned contact aggressively.
    ready[0].contact.messages.push({ step: 99, text: 'INJECTED', sentAt: 'never' });
    ready[0].contact.status = 'mutated';
    ready[0].contact.currentStep = 999;

    // Storage must be unaffected.
    const stored = readStored('data.sequences').items[seq.id].contacts[url];
    expect(stored.messages).toEqual([]);
    expect(stored.status).toBe('active');
    expect(stored.currentStep).toBe(0);
  });
});

// --- Bug 27: recordMessageSent must skip non-active contacts ---

describe('recordMessageSent status guard (Bug 27)', () => {
  const noQuiet = { staggerMinutes: 0, quietHoursStart: 0, quietHoursEnd: 24, weekdaysOnly: false };

  test('replied contact: recordMessageSent is a no-op (no message, no step advance, no schedule)', async () => {
    const seq = await createSequence({
      name: 'C',
      steps: [{ template: 'first' }, { template: 'second', delayDays: 5 }],
      settings: noQuiet
    });
    const url = 'https://www.linkedin.com/in/replied/';
    await enrollContacts(seq.id, [{ name: 'R', profileUrl: url }]);

    // Mark replied first — flips status and increments stats.replied.
    await markReplied(seq.id, url);

    // Snapshot state immediately after markReplied.
    const before = JSON.parse(JSON.stringify(readStored('data.sequences').items[seq.id]));

    // Now call recordMessageSent — must not advance currentStep, must not push
    // a message, must not bump stats.sent, must not reschedule nextMessageAt.
    await recordMessageSent(seq.id, url, 'should not be sent');

    const after = readStored('data.sequences').items[seq.id];
    expect(after.contacts[url].status).toBe('replied');
    expect(after.contacts[url].currentStep).toBe(0);
    expect(after.contacts[url].messages).toEqual([]);
    expect(after.contacts[url].nextMessageAt).toBe(before.contacts[url].nextMessageAt);
    expect(after.stats.sent).toBe(0);
    // stats.completed must not be incremented either.
    expect(after.stats.completed).toBe(0);
  });

  test('completed contact: recordMessageSent is a no-op', async () => {
    const seq = await createSequence({
      name: 'C',
      steps: [{ template: 't' }],
      settings: noQuiet
    });
    const url = 'https://www.linkedin.com/in/done/';
    await enrollContacts(seq.id, [{ name: 'D', profileUrl: url }]);

    // Force completed status directly.
    const data = readStored('data.sequences');
    data.items[seq.id].contacts[url].status = 'completed';
    data.items[seq.id].contacts[url].currentStep = 1;
    _localStore.set('data.sequences', data);

    await recordMessageSent(seq.id, url, 'should not be sent');

    const after = readStored('data.sequences').items[seq.id];
    expect(after.contacts[url].status).toBe('completed');
    expect(after.contacts[url].messages).toEqual([]);
    expect(after.stats.sent).toBe(0);
  });
});

// --- Bug 2: timezone-aware quiet hours ---

describe('nextSendableTime timezone-aware (Bug 2)', () => {
  test('America/Los_Angeles, 11pm LA → next 8am LA (within quiet-hours window)', async () => {
    // 11pm in LA on a Tuesday = 07:00 UTC Wednesday.
    // Pick a clearly-not-DST date to keep math stable.
    // Tuesday, 2026-04-07 23:00 LA = 2026-04-08 06:00 UTC (PDT, UTC-7).
    const tuesdayLA11pm = Date.UTC(2026, 3, 8, 6, 0, 0); // April 8 2026 06:00Z
    const sequence = {
      settings: {
        timezone: 'America/Los_Angeles',
        quietHoursStart: 8,
        quietHoursEnd: 20,
        weekdaysOnly: false
      }
    };
    const next = nextSendableTime(tuesdayLA11pm, sequence);
    // Expected: 8am LA Wednesday = 15:00 UTC.
    const expected = Date.UTC(2026, 3, 8, 15, 0, 0);
    expect(next).toBe(expected);

    // Sanity: getHours-in-zone of the result is 8 in LA.
    const hour = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23'
      }).format(new Date(next)),
      10
    );
    expect(hour).toBe(8);
  });

  test('UTC default: a 23:00 UTC time shifts to 08:00 UTC next day', () => {
    // 2026-06-10 23:00 UTC (a Wednesday).
    const wedNight = Date.UTC(2026, 5, 10, 23, 0, 0);
    const sequence = {
      settings: {
        // timezone defaults to UTC
        quietHoursStart: 8,
        quietHoursEnd: 20,
        weekdaysOnly: false
      }
    };
    const next = nextSendableTime(wedNight, sequence);
    expect(next).toBe(Date.UTC(2026, 5, 11, 8, 0, 0));
  });
});

// --- Bug 3: weekdaysOnly ---

describe('nextSendableTime weekdaysOnly (Bug 3)', () => {
  test('Saturday 10am UTC with weekdaysOnly=true shifts to Monday 8am UTC', () => {
    // 2026-04-11 is a Saturday.
    const sat10am = Date.UTC(2026, 3, 11, 10, 0, 0);
    const sequence = {
      settings: {
        timezone: 'UTC',
        quietHoursStart: 8,
        quietHoursEnd: 20,
        weekdaysOnly: true
      }
    };
    const next = nextSendableTime(sat10am, sequence);
    // Monday 2026-04-13 08:00 UTC.
    const expected = Date.UTC(2026, 3, 13, 8, 0, 0);
    expect(next).toBe(expected);
    expect(new Date(next).getUTCDay()).toBe(1); // Monday
  });

  test('Sunday 9am UTC with weekdaysOnly=true also shifts to Monday 8am UTC', () => {
    // 2026-04-12 is a Sunday.
    const sun9am = Date.UTC(2026, 3, 12, 9, 0, 0);
    const sequence = {
      settings: { timezone: 'UTC', quietHoursStart: 8, quietHoursEnd: 20, weekdaysOnly: true }
    };
    const next = nextSendableTime(sun9am, sequence);
    expect(next).toBe(Date.UTC(2026, 3, 13, 8, 0, 0));
  });

  test('weekdaysOnly=false: Saturday 10am UTC stays Saturday 10am', () => {
    const sat10am = Date.UTC(2026, 3, 11, 10, 0, 0);
    const sequence = {
      settings: { timezone: 'UTC', quietHoursStart: 8, quietHoursEnd: 20, weekdaysOnly: false }
    };
    const next = nextSendableTime(sat10am, sequence);
    expect(next).toBe(sat10am);
  });
});

// --- Bug 25: enrollContacts apiVersion ---

describe('enrollContacts apiVersion (Bug 25)', () => {
  test('returns { apiVersion: 2, enrolled, skipped } shape', async () => {
    const seq = await createSequence({
      name: 'V',
      steps: [{ template: 't' }],
      settings: { staggerMinutes: 0, quietHoursStart: 0, quietHoursEnd: 24, weekdaysOnly: false }
    });
    const result = await enrollContacts(seq.id, [
      { name: 'A', profileUrl: 'https://www.linkedin.com/in/a/' },
      { name: 'B' } // missing profileUrl → skipped
    ]);
    expect(result.apiVersion).toBe(2);
    expect(result.enrolled).toBe(1);
    expect(Array.isArray(result.skipped)).toBe(true);
    expect(result.skipped).toHaveLength(1);
  });
});

// --- Bug 34: processSequences should not double-read sequences ---

describe('processSequences single-read consolidation (Bug 34)', () => {
  test('processSequences with no overruns reads sequences exactly once', async () => {
    const seq = await createSequence({
      name: 'S',
      steps: [{ template: 't' }],
      settings: { staggerMinutes: 0, quietHoursStart: 0, quietHoursEnd: 24, weekdaysOnly: false }
    });
    await enrollContacts(seq.id, [
      { name: 'A', profileUrl: 'https://www.linkedin.com/in/a/' }
    ]);

    // Spy on the module's getSequences entry point. Note: the in-module
    // calls go through the local binding, so we count storage.local.get
    // hits keyed on 'data.sequences' instead — those are the actual reads.
    const getSpy = chrome.storage.local.get;
    getSpy.mockClear();

    await processSequences();

    // Count gets that asked for 'data.sequences'.
    const dataSeqGets = getSpy.mock.calls.filter(args => args[0] === 'data.sequences').length;
    // Bug 34: was 2 (reapCompletedContacts + processSequences). Now should be 1.
    expect(dataSeqGets).toBe(1);
  });

  test('reapCompletedContacts is still exported for direct use', async () => {
    const seq = await createSequence({
      name: 'S',
      steps: [{ template: 't' }],
      settings: { staggerMinutes: 0, quietHoursStart: 0, quietHoursEnd: 24, weekdaysOnly: false }
    });
    const url = 'https://www.linkedin.com/in/over/';
    await enrollContacts(seq.id, [{ name: 'O', profileUrl: url }]);

    // Force overrun.
    const data = readStored('data.sequences');
    data.items[seq.id].contacts[url].currentStep = 5;
    _localStore.set('data.sequences', data);

    await reapCompletedContacts();

    const after = readStored('data.sequences').items[seq.id];
    expect(after.contacts[url].status).toBe('completed');
    expect(after.stats.completed).toBe(1);
  });
});

// --- Bug 2 (revisited): weekdaysOnly default flip must not affect old sequences ---

describe('weekdaysOnly default-flip backward compat (Bug 2)', () => {
  test('old sequence (no weekdaysOnly field): Saturday send-time stays Saturday', () => {
    // Saturday 2026-04-11 10:00 UTC.
    const sat10am = Date.UTC(2026, 3, 11, 10, 0, 0);
    // Old-shape sequence: settings exist but weekdaysOnly is undefined.
    const oldSequence = {
      settings: {
        timezone: 'UTC',
        quietHoursStart: 8,
        quietHoursEnd: 20
        // weekdaysOnly intentionally absent (legacy data)
      }
    };
    const next = nextSendableTime(sat10am, oldSequence);
    // Must NOT shift to Monday — strict-equality default treats undefined as
    // false, preserving prior behavior.
    expect(next).toBe(sat10am);
    expect(new Date(next).getUTCDay()).toBe(6); // Saturday
  });

  test('new sequence created via createSequence has weekdaysOnly: true and shifts Saturday → Monday', async () => {
    const seq = await createSequence({
      name: 'NewDefault',
      steps: [{ template: 't' }]
    });
    // Saturday 2026-04-11 10:00 UTC.
    const sat10am = Date.UTC(2026, 3, 11, 10, 0, 0);
    const next = nextSendableTime(sat10am, seq);
    // New sequences default to weekdaysOnly: true → Sat shifts to Mon 8am UTC.
    expect(seq.settings.weekdaysOnly).toBe(true);
    expect(next).toBe(Date.UTC(2026, 3, 13, 8, 0, 0));
  });

  test('explicit weekdaysOnly: false overrides createSequence default', async () => {
    const seq = await createSequence({
      name: 'OptOut',
      steps: [{ template: 't' }],
      settings: { weekdaysOnly: false, timezone: 'UTC', quietHoursStart: 8, quietHoursEnd: 20 }
    });
    expect(seq.settings.weekdaysOnly).toBe(false);
    const sat10am = Date.UTC(2026, 3, 11, 10, 0, 0);
    expect(nextSendableTime(sat10am, seq)).toBe(sat10am);
  });
});

// --- Bug 3 (revisited): default staggerMinutes is 1 ---

describe('default staggerMinutes (Bug 3)', () => {
  test('createSequence with no settings: staggerMinutes defaults to 1', async () => {
    const seq = await createSequence({ name: 'D', steps: [{ template: 't' }] });
    expect(seq.settings.staggerMinutes).toBe(1);
  });

  test('enrollContacts spaces contacts 1 minute apart by default', async () => {
    // Pin tz/window so quiet-hours don't interfere; weekdaysOnly:false to
    // avoid weekend shifts. Don't override staggerMinutes — exercise the default.
    const seq = await createSequence({
      name: 'DefaultStagger',
      steps: [{ template: 't' }],
      settings: { quietHoursStart: 0, quietHoursEnd: 24, weekdaysOnly: false }
    });
    const result = await enrollContacts(seq.id, [
      { name: 'A', profileUrl: 'https://www.linkedin.com/in/a/' },
      { name: 'B', profileUrl: 'https://www.linkedin.com/in/b/' },
      { name: 'C', profileUrl: 'https://www.linkedin.com/in/c/' }
    ]);
    expect(result.enrolled).toBe(3);
    const stored = readStored('data.sequences').items[seq.id];
    const tA = new Date(stored.contacts['https://www.linkedin.com/in/a/'].nextMessageAt).getTime();
    const tB = new Date(stored.contacts['https://www.linkedin.com/in/b/'].nextMessageAt).getTime();
    const tC = new Date(stored.contacts['https://www.linkedin.com/in/c/'].nextMessageAt).getTime();
    expect(tB - tA).toBe(60 * 1000);
    expect(tC - tB).toBe(60 * 1000);
  });
});

// --- Bug 28: wrap-around quiet hours (start > end) ---

describe('nextSendableTime wrap-around quiet hours (Bug 28)', () => {
  test('quietHoursStart=23, quietHoursEnd=7: a 02:00 UTC send is valid', () => {
    // Tuesday 2026-04-14 02:00 UTC — clearly inside the wrap window 23..7.
    const tue02 = Date.UTC(2026, 3, 14, 2, 0, 0);
    const sequence = {
      settings: {
        timezone: 'UTC',
        quietHoursStart: 23,
        quietHoursEnd: 7,
        weekdaysOnly: false
      }
    };
    const next = nextSendableTime(tue02, sequence);
    expect(next).toBe(tue02);
  });

  test('wrap window 23..7: 23:30 UTC stays 23:30 UTC', () => {
    const tue2330 = Date.UTC(2026, 3, 14, 23, 30, 0);
    const sequence = {
      settings: { timezone: 'UTC', quietHoursStart: 23, quietHoursEnd: 7, weekdaysOnly: false }
    };
    expect(nextSendableTime(tue2330, sequence)).toBe(tue2330);
  });

  test('wrap window 23..7: 12:00 UTC (midday) shifts forward to 23:00 UTC', () => {
    // Tuesday 2026-04-14 12:00 UTC — outside the wrap window.
    const tue12 = Date.UTC(2026, 3, 14, 12, 0, 0);
    const sequence = {
      settings: { timezone: 'UTC', quietHoursStart: 23, quietHoursEnd: 7, weekdaysOnly: false }
    };
    const next = nextSendableTime(tue12, sequence);
    expect(next).toBe(Date.UTC(2026, 3, 14, 23, 0, 0));
  });
});

// --- Bug 31: restagger ---

describe('restagger pending contacts (Bug 31)', () => {
  test('restagger is exported', () => {
    expect(typeof restagger).toBe('function');
  });

  test('only restages contacts with no messages and active status; mid-sequence contacts unchanged', async () => {
    // Use noQuiet so initial nextMessageAt is approx Date.now() with stagger 0.
    const seq = await createSequence({
      name: 'R',
      steps: [{ template: 'first' }, { template: 'second' }],
      settings: { staggerMinutes: 0, quietHoursStart: 0, quietHoursEnd: 24, weekdaysOnly: false }
    });
    const urlA = 'https://www.linkedin.com/in/a/';
    const urlB = 'https://www.linkedin.com/in/b/';
    const urlC = 'https://www.linkedin.com/in/c/';
    await enrollContacts(seq.id, [
      { name: 'A', profileUrl: urlA },
      { name: 'B', profileUrl: urlB },
      { name: 'C', profileUrl: urlC }
    ]);

    // Simulate B already having received message #1 (mid-sequence).
    const data = readStored('data.sequences');
    data.items[seq.id].contacts[urlB].messages = [
      { step: 0, text: 'sent', sentAt: new Date().toISOString() }
    ];
    data.items[seq.id].contacts[urlB].currentStep = 1;
    const bNextBefore = data.items[seq.id].contacts[urlB].nextMessageAt;
    // Bump staggerMinutes to 10 so re-stagger spacing is detectably different.
    data.items[seq.id].settings.staggerMinutes = 10;
    _localStore.set('data.sequences', data);

    const result = await restagger(seq.id);
    // A and C are pending; B is mid-sequence and must be skipped.
    expect(result.restaggered).toBe(2);

    const after = readStored('data.sequences').items[seq.id];
    expect(after.contacts[urlB].nextMessageAt).toBe(bNextBefore);

    // A and C should now be 10 minutes apart.
    const tA = new Date(after.contacts[urlA].nextMessageAt).getTime();
    const tC = new Date(after.contacts[urlC].nextMessageAt).getTime();
    expect(tC - tA).toBe(10 * 60 * 1000);
  });

  test('restagger no-op for unknown sequenceId', async () => {
    const result = await restagger('seq_does_not_exist');
    expect(result).toBeUndefined();
  });
});

// --- Bug 20: cohort normalizeMembers must keep entries without LinkedIn URL ---

describe('cohort normalizeMembers keeps off-LinkedIn members (Bug 20)', () => {
  test('saving cohort with members lacking linkedin retains them on read', async () => {
    // Wire storage mock as in beforeEach (already done). Test through public API.
    const Cohort = await import('../src/background/cohort-manager.js');
    await Cohort.saveCohortConfig({
      cohort: 'Test',
      members: [
        { name: 'WithLinkedIn', linkedin: 'https://www.linkedin.com/in/foo/', company: 'X' },
        { name: 'NoLinkedIn', company: 'Y' },
        { name: 'EmptyLinkedIn', linkedin: '', company: 'Z' }
      ]
    });
    const cfg = await Cohort.getCohortConfig();
    expect(cfg.members).toHaveLength(3);
    expect(cfg.members.find(m => m.name === 'NoLinkedIn')).toEqual({
      name: 'NoLinkedIn', linkedin: '', company: 'Y'
    });
    expect(cfg.members.find(m => m.name === 'EmptyLinkedIn')).toEqual({
      name: 'EmptyLinkedIn', linkedin: '', company: 'Z'
    });
  });

  test('detectWarmIntros skips members without linkedin (per-iteration filter)', async () => {
    const Cohort = await import('../src/background/cohort-manager.js');
    await Cohort.saveCohortConfig({
      cohort: 'Test',
      members: [
        { name: 'NoLinkedIn', company: 'Y' },
        { name: 'Has', linkedin: 'https://www.linkedin.com/in/has/', company: 'X' }
      ],
      // The "Has" member has the target as a connection.
      connectionMap: {
        has: ['https://www.linkedin.com/in/target/']
      }
    });
    const matches = await Cohort.detectWarmIntros('https://www.linkedin.com/in/target/');
    expect(matches).toHaveLength(1);
    expect(matches[0].memberName).toBe('Has');
  });
});
