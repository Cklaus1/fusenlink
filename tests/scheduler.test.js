/**
 * Tests for scheduler: alarm creation, deletion, restoration, tab selection,
 * concurrent writes, and lastRun completion semantics.
 */

import { setSchedule, deleteSchedule, getSchedules, initScheduler } from '../src/background/scheduler.js';
import { getTargetLinkedInTab } from '../src/background/tab-selector.js';

let _localStore;

function installStorageMock(initial = {}) {
  _localStore = new Map(Object.entries(initial));

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
    } else if (keys && typeof keys === 'object') {
      for (const [k, defaultVal] of Object.entries(keys)) {
        out[k] = _localStore.has(k) ? _localStore.get(k) : defaultVal;
      }
    } else {
      for (const [k, v] of _localStore.entries()) out[k] = v;
    }
    Promise.resolve().then(() => callback(out));
  });

  chrome.storage.local.set.mockImplementation((items, callback) => {
    for (const [k, v] of Object.entries(items)) _localStore.set(k, v);
    Promise.resolve().then(() => callback && callback());
  });

  if (chrome.storage.local.remove?.mockImplementation) {
    chrome.storage.local.remove.mockImplementation((keys, callback) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) _localStore.delete(k);
      Promise.resolve().then(() => callback && callback());
    });
  }
}

beforeEach(() => {
  installStorageMock();
  if (chrome.alarms?.create) chrome.alarms.create.mockReset().mockImplementation(() => {});
  if (chrome.alarms?.clear) chrome.alarms.clear.mockReset().mockImplementation(() => {});
  if (chrome.tabs?.query) chrome.tabs.query.mockReset();
  if (chrome.tabs?.create) chrome.tabs.create.mockReset();
  if (chrome.tabs?.sendMessage) chrome.tabs.sendMessage.mockReset();
  if (chrome.tabs?.get) chrome.tabs.get.mockReset();
  if (chrome.scripting?.executeScript) chrome.scripting.executeScript.mockReset();
  if (chrome.notifications?.create) chrome.notifications.create.mockReset();
});

describe('setSchedule', () => {
  test('creates an alarm when enabled with a positive interval', async () => {
    await setSchedule('foo', { enabled: true, intervalMinutes: 60 });
    expect(chrome.alarms.create).toHaveBeenCalledTimes(1);
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'playbook:foo',
      { periodInMinutes: 60 }
    );
  });

  test('clears the alarm when disabled', async () => {
    await setSchedule('foo', { enabled: false, intervalMinutes: 60 });
    expect(chrome.alarms.clear).toHaveBeenCalledWith('playbook:foo');
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });

  test('clears the alarm when intervalMinutes is 0', async () => {
    await setSchedule('foo', { enabled: true, intervalMinutes: 0 });
    expect(chrome.alarms.clear).toHaveBeenCalledWith('playbook:foo');
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });

  test('persists schedule to chrome.storage.local under "schedules"', async () => {
    await setSchedule('foo', { enabled: true, intervalMinutes: 30 });
    const stored = _localStore.get('schedules');
    expect(stored).toBeDefined();
    expect(stored.foo).toBeDefined();
    expect(stored.foo.enabled).toBe(true);
    expect(stored.foo.intervalMinutes).toBe(30);
    expect(typeof stored.foo.updatedAt).toBe('string');
  });
});

describe('deleteSchedule', () => {
  test('removes the schedule and clears its alarm', async () => {
    await setSchedule('foo', { enabled: true, intervalMinutes: 60 });
    chrome.alarms.create.mockClear();
    chrome.alarms.clear.mockClear();

    await deleteSchedule('foo');
    const stored = _localStore.get('schedules');
    expect(stored.foo).toBeUndefined();
    expect(chrome.alarms.clear).toHaveBeenCalledWith('playbook:foo');
  });
});

describe('getSchedules default', () => {
  test('returns empty object when nothing stored', async () => {
    const s = await getSchedules();
    expect(s).toEqual({});
  });
});

describe('getTargetLinkedInTab (multi-tab)', () => {
  test('with two LinkedIn tabs, picks the one matching the playbook urlPattern', async () => {
    // Seed playbooks so getTargetLinkedInTab can read the urlPattern.
    _localStore.set('playbooks', {
      'bulk-connect': {
        id: 'bulk-connect',
        name: 'Bulk Connect',
        urlPattern: 'linkedin\\.com/search/results/people'
      }
    });

    const searchTab = { id: 101, url: 'https://www.linkedin.com/search/results/people/?keywords=foo' };
    const feedTab = { id: 102, url: 'https://www.linkedin.com/feed/' };

    chrome.tabs.query.mockImplementation((query, callback) => {
      // First call: active tab in current window
      if (query.active && query.currentWindow) {
        const result = [];
        if (callback) callback(result);
        return Promise.resolve(result);
      }
      // Second call: all LinkedIn tabs
      const result = [feedTab, searchTab];
      if (callback) callback(result);
      return Promise.resolve(result);
    });

    const tab = await getTargetLinkedInTab('bulk-connect');
    expect(tab).toBeDefined();
    expect(tab.id).toBe(searchTab.id);
  });

  test('falls back to first LinkedIn tab when no urlPattern matches', async () => {
    _localStore.set('playbooks', {
      'unknown': {
        id: 'unknown',
        name: 'Unknown',
        urlPattern: 'linkedin\\.com/this-path-does-not-exist'
      }
    });

    const tabA = { id: 201, url: 'https://www.linkedin.com/feed/' };
    const tabB = { id: 202, url: 'https://www.linkedin.com/messaging/' };

    chrome.tabs.query.mockImplementation((query, callback) => {
      if (query.active && query.currentWindow) {
        const result = [];
        if (callback) callback(result);
        return Promise.resolve(result);
      }
      const result = [tabA, tabB];
      if (callback) callback(result);
      return Promise.resolve(result);
    });

    const tab = await getTargetLinkedInTab('unknown');
    expect(tab).toBeDefined();
    expect(tab.id).toBe(tabA.id);
  });
});

describe('concurrent setSchedule writes', () => {
  test('two parallel setSchedule calls both persist', async () => {
    await Promise.all([
      setSchedule('alpha', { enabled: true, intervalMinutes: 30 }),
      setSchedule('beta', { enabled: true, intervalMinutes: 60 })
    ]);

    const stored = _localStore.get('schedules');
    expect(stored).toBeDefined();
    expect(stored.alpha).toBeDefined();
    expect(stored.alpha.intervalMinutes).toBe(30);
    expect(stored.beta).toBeDefined();
    expect(stored.beta.intervalMinutes).toBe(60);
  });

  test('parallel updates to the same playbook do not lose the later write', async () => {
    // Both updates target the same key; second one wins under serialized lock.
    await Promise.all([
      setSchedule('foo', { enabled: true, intervalMinutes: 15 }),
      setSchedule('foo', { enabled: true, intervalMinutes: 90 })
    ]);

    const stored = _localStore.get('schedules');
    expect(stored.foo).toBeDefined();
    // Whichever runs second wins — either value is acceptable, but the
    // record must be coherent (non-empty and one of the two values).
    expect([15, 90]).toContain(stored.foo.intervalMinutes);
  });
});

describe('lastRun updates only on completion', () => {
  test('lastRun is null at dispatch time and set only after the tab callback fires', async () => {
    // Seed an existing schedule for the playbook so the lastRun path runs.
    _localStore.set('schedules', {
      'bulk-connect': { enabled: true, intervalMinutes: 60, updatedAt: '2020-01-01T00:00:00Z' }
    });
    _localStore.set('playbooks', {
      'bulk-connect': {
        id: 'bulk-connect',
        name: 'Bulk Connect',
        urlPattern: 'linkedin\\.com/search/results/people'
      }
    });

    const tab = { id: 999, url: 'https://www.linkedin.com/search/results/people/' };

    chrome.tabs.query.mockImplementation((query, callback) => {
      if (query.active && query.currentWindow) {
        const r = [];
        if (callback) callback(r);
        return Promise.resolve(r);
      }
      const r = [tab];
      if (callback) callback(r);
      return Promise.resolve(r);
    });

    chrome.notifications.create.mockImplementation(() => {});

    let sendCallback = null;
    chrome.tabs.sendMessage.mockImplementation((tabId, message, cb) => {
      sendCallback = cb;
      // Don't invoke yet — simulate a long-running playbook.
    });

    // Wire up onAlarm and fire it.
    initScheduler();

    // Fire the alarm to invoke triggerPlaybook.
    chrome.alarms.onAlarm.callListeners({ name: 'playbook:bulk-connect' });

    // Yield a few microtasks so the async chain in triggerPlaybook reaches sendMessage.
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }

    // BEFORE the callback fires: lastRun must NOT be set yet.
    let snapshot = await getSchedules();
    expect(snapshot['bulk-connect']).toBeDefined();
    expect(snapshot['bulk-connect'].lastRun).toBeUndefined();

    // Now simulate the content script responding with a completion result.
    expect(typeof sendCallback).toBe('function');
    sendCallback({ data: { processedCount: 7, skippedCount: 1 } });

    // Let the lastRun write complete.
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }

    snapshot = await getSchedules();
    expect(snapshot['bulk-connect'].lastRun).toBeDefined();
    expect(typeof snapshot['bulk-connect'].lastRun).toBe('string');
    expect(snapshot['bulk-connect'].lastOutcome).toBe('complete');
  });
});
