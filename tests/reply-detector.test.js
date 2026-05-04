/**
 * Tests for reply-detector: slug-first matching, name fallback, ambiguity skip,
 * and notification delivery.
 *
 * sequence-manager and data-store are mocked so we can directly control state
 * and assert on markReplied / logActivity calls.
 */

jest.mock('../src/background/sequence-manager.js', () => ({
  getSequences: jest.fn(),
  markReplied: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../src/background/data-store.js', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined)
}));

import { checkForReplies } from '../src/background/reply-detector.js';
import * as Seq from '../src/background/sequence-manager.js';
import * as Data from '../src/background/data-store.js';

let _localStore;

function installStorageMock(initial = {}) {
  _localStore = new Map(Object.entries(initial));

  chrome.storage.local.get.mockImplementation((keys, callback) => {
    let out = {};
    if (typeof keys === 'string') {
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
}

function makeContact(over = {}) {
  return {
    name: 'Anonymous',
    headline: '',
    profileUrl: 'https://www.linkedin.com/in/x/',
    currentStep: 1,
    status: 'active',
    enrolledAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
    nextMessageAt: new Date().toISOString(),
    messages: [{ step: 0, text: 'hello', sentAt: new Date().toISOString() }],
    ...over
  };
}

beforeEach(() => {
  installStorageMock();
  Seq.getSequences.mockReset();
  Seq.markReplied.mockReset().mockResolvedValue(undefined);
  Data.logActivity.mockReset().mockResolvedValue(undefined);

  // Default: no live messaging tabs, no stored inbox
  if (chrome.tabs?.query) {
    chrome.tabs.query.mockImplementation((q, cb) => {
      // chrome.tabs.query returns a Promise in MV3; reply-detector awaits it.
      // jest-chrome's stub returns whatever we make it return synchronously
      // wrapped or via callback; safest is to return [] directly.
      const result = [];
      if (typeof cb === 'function') cb(result);
      return Promise.resolve(result);
    });
  }
  if (chrome.notifications?.create) {
    chrome.notifications.create.mockReset().mockImplementation(() => {});
  }
  if (chrome.tabs?.sendMessage) chrome.tabs.sendMessage.mockReset();
  if (chrome.alarms?.create) chrome.alarms.create.mockImplementation(() => {});
});

describe('checkForReplies — slug-first matching', () => {
  test('matches active contact via inbox profileUrls (slug)', async () => {
    Seq.getSequences.mockResolvedValue({
      items: {
        s1: {
          id: 's1',
          status: 'active',
          contacts: {
            'https://www.linkedin.com/in/john-smith/': makeContact({
              name: 'John Smith',
              profileUrl: 'https://www.linkedin.com/in/john-smith/'
            })
          }
        }
      }
    });

    // Seed stored inbox so extractConversationNames returns the slug name too.
    // Actually we want to test the live-inbox slug path: stub tabs.query to
    // return a fake messaging tab and tabs.sendMessage to return profileUrls.
    chrome.tabs.query.mockImplementation((q, cb) => {
      const result = [{ id: 99 }];
      if (typeof cb === 'function') cb(result);
      return Promise.resolve(result);
    });
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      cb({ names: [], profileUrls: ['john-smith'] });
    });

    const result = await checkForReplies();

    expect(result.detected).toBe(1);
    expect(result.contacts).toEqual(['John Smith']);
    expect(Seq.markReplied).toHaveBeenCalledTimes(1);
    expect(Seq.markReplied).toHaveBeenCalledWith('s1', 'https://www.linkedin.com/in/john-smith/');
    expect(Data.logActivity).toHaveBeenCalledTimes(1);
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
  });
});

describe('checkForReplies — name fallback unambiguous', () => {
  test('matches contact by name alone when slugs are not available', async () => {
    Seq.getSequences.mockResolvedValue({
      items: {
        s1: {
          id: 's1',
          status: 'active',
          contacts: {
            'https://www.linkedin.com/in/jane-doe/': makeContact({
              name: 'Jane Doe',
              profileUrl: 'https://www.linkedin.com/in/jane-doe/'
            })
          }
        }
      }
    });

    chrome.tabs.query.mockImplementation((q, cb) => {
      const result = [{ id: 99 }];
      if (typeof cb === 'function') cb(result);
      return Promise.resolve(result);
    });
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      cb({ names: ['Jane Doe'], profileUrls: [] });
    });

    const result = await checkForReplies();

    expect(result.detected).toBe(1);
    expect(Seq.markReplied).toHaveBeenCalledTimes(1);
    expect(Seq.markReplied).toHaveBeenCalledWith('s1', 'https://www.linkedin.com/in/jane-doe/');
  });
});

describe('checkForReplies — ambiguous name skipped', () => {
  test('two active contacts named "John Smith" in different sequences are both skipped when only name available', async () => {
    Seq.getSequences.mockResolvedValue({
      items: {
        s1: {
          id: 's1',
          status: 'active',
          contacts: {
            'https://www.linkedin.com/in/john-smith-a/': makeContact({
              name: 'John Smith',
              profileUrl: 'https://www.linkedin.com/in/john-smith-a/'
            })
          }
        },
        s2: {
          id: 's2',
          status: 'active',
          contacts: {
            'https://www.linkedin.com/in/john-smith-b/': makeContact({
              name: 'John Smith',
              profileUrl: 'https://www.linkedin.com/in/john-smith-b/'
            })
          }
        }
      }
    });

    chrome.tabs.query.mockImplementation((q, cb) => {
      const result = [{ id: 99 }];
      if (typeof cb === 'function') cb(result);
      return Promise.resolve(result);
    });
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      cb({ names: ['John Smith'], profileUrls: [] });
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await checkForReplies();

    expect(result.detected).toBe(0);
    expect(Seq.markReplied).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/ambiguous name/i)
    );
    expect(chrome.notifications.create).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe('checkForReplies — mixed slug + name', () => {
  test('one contact matched by slug, another by name; both get marked', async () => {
    Seq.getSequences.mockResolvedValue({
      items: {
        s1: {
          id: 's1',
          status: 'active',
          contacts: {
            'https://www.linkedin.com/in/alice-slug/': makeContact({
              name: 'Alice Slugmatch',
              profileUrl: 'https://www.linkedin.com/in/alice-slug/'
            }),
            'https://www.linkedin.com/in/bob-namematch/': makeContact({
              name: 'Bob Namematch',
              profileUrl: 'https://www.linkedin.com/in/bob-namematch/'
            })
          }
        }
      }
    });

    chrome.tabs.query.mockImplementation((q, cb) => {
      const result = [{ id: 99 }];
      if (typeof cb === 'function') cb(result);
      return Promise.resolve(result);
    });
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      cb({
        names: ['Bob Namematch'],
        profileUrls: ['alice-slug']
      });
    });

    const result = await checkForReplies();

    expect(result.detected).toBe(2);
    expect(result.contacts).toEqual(expect.arrayContaining(['Alice Slugmatch', 'Bob Namematch']));
    expect(Seq.markReplied).toHaveBeenCalledTimes(2);
    expect(Seq.markReplied).toHaveBeenCalledWith('s1', 'https://www.linkedin.com/in/alice-slug/');
    expect(Seq.markReplied).toHaveBeenCalledWith('s1', 'https://www.linkedin.com/in/bob-namematch/');
    expect(Data.logActivity).toHaveBeenCalledTimes(2);
  });
});

describe('checkForReplies — corner cases', () => {
  test('returns early with detected: 0 when no active contacts have sent messages', async () => {
    Seq.getSequences.mockResolvedValue({
      items: {
        s1: {
          id: 's1',
          status: 'active',
          contacts: {
            'https://www.linkedin.com/in/alice/': makeContact({
              name: 'Alice',
              profileUrl: 'https://www.linkedin.com/in/alice/',
              messages: [] // no messages sent yet
            })
          }
        }
      }
    });

    const result = await checkForReplies();
    expect(result.detected).toBe(0);
    expect(Seq.markReplied).not.toHaveBeenCalled();
  });

  test('skips paused sequences', async () => {
    Seq.getSequences.mockResolvedValue({
      items: {
        s1: {
          id: 's1',
          status: 'paused',
          contacts: {
            'https://www.linkedin.com/in/alice/': makeContact({
              name: 'Alice',
              profileUrl: 'https://www.linkedin.com/in/alice/'
            })
          }
        }
      }
    });

    chrome.tabs.query.mockImplementation((q, cb) => {
      const result = [{ id: 99 }];
      if (typeof cb === 'function') cb(result);
      return Promise.resolve(result);
    });
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      cb({ names: ['Alice'], profileUrls: ['alice'] });
    });

    const result = await checkForReplies();
    expect(result.detected).toBe(0);
    expect(Seq.markReplied).not.toHaveBeenCalled();
  });

  test('does not double-mark a contact that matches both slug and name', async () => {
    Seq.getSequences.mockResolvedValue({
      items: {
        s1: {
          id: 's1',
          status: 'active',
          contacts: {
            'https://www.linkedin.com/in/alice/': makeContact({
              name: 'Alice',
              profileUrl: 'https://www.linkedin.com/in/alice/'
            })
          }
        }
      }
    });

    chrome.tabs.query.mockImplementation((q, cb) => {
      const result = [{ id: 99 }];
      if (typeof cb === 'function') cb(result);
      return Promise.resolve(result);
    });
    chrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      cb({ names: ['Alice'], profileUrls: ['alice'] });
    });

    const result = await checkForReplies();
    expect(result.detected).toBe(1);
    expect(Seq.markReplied).toHaveBeenCalledTimes(1);
  });
});
