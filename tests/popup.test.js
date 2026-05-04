/**
 * Smoke tests for src/ui/popup.js.
 *
 * popup.js is IIFE-style and runs as soon as it is required (no exports).
 * The strategy here is integration-style: stub the DOM popup.html provides,
 * stub the chrome.* APIs popup.js calls during boot, then `require` the file
 * inside isolateModules and verify it does not throw.
 *
 * We also inline-test the local date helpers' observable behavior via the
 * same boot path: by stubbing `chrome.runtime.sendMessage` to return mixed
 * activity log entries we confirm `sumProcessedToday` does not double-count
 * checkpoints (Bug 4) by inspecting the rendered playbook list.
 */

describe('popup.js (smoke)', () => {
  let originalLocation;

  // Build the minimum DOM popup.js queries during boot/render.
  function setupDom() {
    document.body.innerHTML = `
      <div id="runningBanner"></div>
      <span id="runningText"></span>
      <button id="stopBtn"></button>
      <div id="aiBanner"></div>
      <a id="settingsLink"></a>
      <a id="setupAI"></a>
      <span id="version"></span>
      <div class="tab" data-tab="playbooks"></div>
      <div class="tab" data-tab="schedule"></div>
      <div class="tab" data-tab="history"></div>
      <div id="tab-playbooks" class="tab-content"></div>
      <div id="tab-schedule" class="tab-content"></div>
      <div id="tab-history" class="tab-content"></div>
      <ul id="playbooks"></ul>
      <div id="scheduleList"></div>
      <div id="historyList"></div>
      <div id="dataSection"></div>
      <div id="status"></div>
      <div id="pipelineFunnel"></div>
      <div id="pipelineSequences"></div>
      <div id="pipelineRecent"></div>
      <div id="cohortContent"></div>
    `;
  }

  beforeEach(() => {
    jest.resetModules();
    setupDom();

    originalLocation = window.location;

    // Reset chrome mocks for this suite
    if (chrome.runtime.sendMessage.mockReset) {
      chrome.runtime.sendMessage.mockReset();
    }

    // Provide manifest.version for `chrome.runtime.getManifest()`
    chrome.runtime.getManifest = jest.fn(() => ({ version: '1.0.0-test' }));
    chrome.runtime.openOptionsPage = jest.fn();
    // chrome.runtime.lastError is undefined by default in jest-chrome and
    // assigning null is rejected; leave it alone.

    // Stub storage events
    chrome.storage.onChanged = chrome.storage.onChanged || {};
    chrome.storage.onChanged.addListener = jest.fn();
    chrome.storage.onChanged.removeListener = jest.fn();

    // Stub chrome.storage.local.get
    chrome.storage.local.get = jest.fn((keys, callback) => callback({}));

    // Stub chrome.tabs API used by runPlaybook (not exercised in basic smoke)
    chrome.tabs = chrome.tabs || {};
    chrome.tabs.query = jest.fn((q, cb) => cb([{ id: 1, url: 'https://www.linkedin.com/' }]));
    chrome.tabs.update = jest.fn();
    chrome.tabs.onUpdated = chrome.tabs.onUpdated || { addListener: jest.fn(), removeListener: jest.fn() };
    chrome.tabs.onRemoved = chrome.tabs.onRemoved || { addListener: jest.fn(), removeListener: jest.fn() };
  });

  afterEach(() => {
    // Restore window.location if we replaced it
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true
    });
  });

  test('boots without throwing when chrome APIs return canned responses', () => {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (!cb) return;
      switch (msg.action) {
        case 'getDailyLimits': return cb({});
        case 'aiStatus': return cb({ configured: true, reachable: true });
        case 'getPlaybookStatus': return cb({ status: 'idle' });
        case 'getAllPlaybooks': return cb({});
        case 'getData': return cb({ entries: [], items: {} });
        case 'getSequences': return cb({ items: {} });
        default: return cb(null);
      }
    });

    expect(() => {
      jest.isolateModules(() => {
        require('../src/ui/popup.js');
      });
    }).not.toThrow();

    // The version label should be populated by manifest
    expect(document.getElementById('version').textContent).toBe('v1.0.0-test');
    // AI banner should NOT be active (configured + reachable)
    expect(document.getElementById('aiBanner').classList.contains('active')).toBe(false);
  });

  test('shows AI banner when aiStatus reports unconfigured', () => {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (!cb) return;
      switch (msg.action) {
        case 'getDailyLimits': return cb({});
        case 'aiStatus': return cb({ configured: false, reachable: false });
        case 'getPlaybookStatus': return cb({ status: 'idle' });
        case 'getAllPlaybooks': return cb({});
        case 'getData': return cb({ entries: [] });
        default: return cb(null);
      }
    });

    jest.isolateModules(() => {
      require('../src/ui/popup.js');
    });

    expect(document.getElementById('aiBanner').classList.contains('active')).toBe(true);
  });

  test('renders playbook list with today counts deduped by runId (Bug 4 regression guard)', () => {
    const today = Date.now();
    const playbooks = {
      'accept-invites': {
        id: 'accept-invites',
        name: 'Accept Invites',
        description: 'Accept pending',
        urlPattern: 'linkedin\\.com/mynetwork',
        selectors: 'linkedin.invitations',
        steps: [],
        version: 1
      }
    };

    // Same runId logged 3 times (checkpoints + final).  In-progress should be skipped,
    // and within a runId the highest processedCount wins.  Final total: 7.
    const entries = [
      { id: 'a', runId: 'r1', playbookId: 'accept-invites', timestamp: today, outcome: 'in_progress', processedCount: 3 },
      { id: 'b', runId: 'r1', playbookId: 'accept-invites', timestamp: today, outcome: 'in_progress', processedCount: 5 },
      { id: 'c', runId: 'r1', playbookId: 'accept-invites', timestamp: today, outcome: 'complete',    processedCount: 7 }
    ];

    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (!cb) return;
      switch (msg.action) {
        case 'getDailyLimits': return cb({ 'accept-invites': 25 });
        case 'aiStatus': return cb({ configured: true, reachable: true });
        case 'getPlaybookStatus': return cb({ status: 'idle' });
        case 'getAllPlaybooks': return cb(playbooks);
        case 'getData':
          if (msg.collection === 'activityLog') return cb({ entries });
          return cb({ entries: [], items: {} });
        case 'getSequences': return cb({ items: {} });
        default: return cb(null);
      }
    });

    jest.isolateModules(() => {
      require('../src/ui/popup.js');
    });

    // Description should reflect the deduped count: "7/25 today" — NOT 15 (3+5+7) and NOT 12 (5+7).
    const descText = document.querySelector('#playbooks .pdesc')?.textContent || '';
    expect(descText).toMatch(/7\/25 today/);
  });
});
