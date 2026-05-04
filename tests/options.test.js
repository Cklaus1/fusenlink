/**
 * Smoke tests for src/ui/options.js.
 *
 * options.js is also IIFE-style (no exports) — it grabs DOM refs at module
 * top-level and registers DOMContentLoaded + form submit listeners. Strategy:
 * stub the DOM elements options.html provides, mock chrome.* APIs, then
 * require the file and dispatch events to assert handler behavior.
 */

describe('options.js (smoke)', () => {
  function setupDom() {
    document.body.innerHTML = `
      <form id="settingsForm">
        <input type="number" id="maxInvites" />
        <input type="number" id="delayMs" />
        <button type="submit">Save</button>
      </form>

      <form id="limitsForm">
        <input type="number" id="limitAccept" />
        <input type="number" id="limitConnect" />
        <input type="number" id="limitExtract" />
        <button type="submit">Save</button>
      </form>

      <form id="aiForm">
        <select id="aiProvider">
          <option value="ollama">Ollama</option>
          <option value="openai">OpenAI</option>
        </select>
        <input type="text" id="aiBaseUrl" />
        <input type="password" id="aiApiKey" />
        <input type="text" id="aiModel" />
        <button type="submit">Save</button>
        <button type="button" id="testConnection">Test Connection</button>
        <div id="testResult"></div>
      </form>

      <form id="cohortForm">
        <input type="text" id="cohortName" />
        <input type="text" id="cohortSyncUrl" />
        <input type="text" id="cohortMySlug" />
        <textarea id="cohortMembers"></textarea>
        <button type="submit">Save</button>
      </form>

      <div id="storageStats"></div>
      <div id="migrationLog"></div>
      <div id="toast"></div>
    `;
  }

  beforeEach(() => {
    jest.resetModules();
    setupDom();

    if (chrome.runtime.sendMessage.mockReset) {
      chrome.runtime.sendMessage.mockReset();
    }
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (cb) cb({});
    });

    chrome.storage.local.get = jest.fn((keys, cb) => cb({}));
    chrome.storage.local.set = jest.fn((items, cb) => { if (cb) cb(); });
  });

  test('settings form submit calls setSettings via chrome.runtime.sendMessage', () => {
    jest.isolateModules(() => {
      require('../src/ui/options.js');
    });

    document.getElementById('maxInvites').value = '42';
    document.getElementById('delayMs').value = '2000';

    const form = document.getElementById('settingsForm');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const setSettingsCall = chrome.runtime.sendMessage.mock.calls.find(
      (c) => c[0]?.action === 'setSettings'
    );
    expect(setSettingsCall).toBeDefined();
    expect(setSettingsCall[0].settings).toEqual({ maxInvites: 42, delayMs: 2000 });
  });

  test('settings form rejects out-of-range values without sending', () => {
    jest.isolateModules(() => {
      require('../src/ui/options.js');
    });

    chrome.runtime.sendMessage.mockClear();

    document.getElementById('maxInvites').value = '0'; // below minimum
    document.getElementById('delayMs').value = '2000';

    const form = document.getElementById('settingsForm');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const setSettingsCall = chrome.runtime.sendMessage.mock.calls.find(
      (c) => c[0]?.action === 'setSettings'
    );
    expect(setSettingsCall).toBeUndefined();
  });

  test('AI form submit calls aiConfigure with the configured fields', () => {
    jest.isolateModules(() => {
      require('../src/ui/options.js');
    });

    document.getElementById('aiProvider').value = 'openai';
    document.getElementById('aiBaseUrl').value = 'https://api.openai.com/v1';
    document.getElementById('aiApiKey').value = 'sk-test';
    document.getElementById('aiModel').value = 'gpt-4o';

    const aiForm = document.getElementById('aiForm');
    aiForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const aiConfigureCall = chrome.runtime.sendMessage.mock.calls.find(
      (c) => c[0]?.action === 'aiConfigure'
    );
    expect(aiConfigureCall).toBeDefined();
    expect(aiConfigureCall[0].config).toEqual({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o'
    });
  });

  test('changing AI provider auto-fills baseUrl and model defaults', () => {
    jest.isolateModules(() => {
      require('../src/ui/options.js');
    });

    const provider = document.getElementById('aiProvider');
    provider.value = 'openai';
    provider.dispatchEvent(new Event('change'));

    expect(document.getElementById('aiBaseUrl').value).toBe('https://api.openai.com/v1');
    expect(document.getElementById('aiModel').value).toBe('gpt-4o');
  });

  test('limits form submit calls setDailyLimits via chrome.runtime.sendMessage', () => {
    jest.isolateModules(() => {
      require('../src/ui/options.js');
    });

    document.getElementById('limitAccept').value = '7';
    document.getElementById('limitConnect').value = '4';
    document.getElementById('limitExtract').value = '15';

    const limitsForm = document.getElementById('limitsForm');
    limitsForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const call = chrome.runtime.sendMessage.mock.calls.find(
      (c) => c[0]?.action === 'setDailyLimits'
    );
    expect(call).toBeDefined();
    expect(call[0].limits['accept-invites']).toBe(7);
    expect(call[0].limits['bulk-connect']).toBe(4);
    expect(call[0].limits['extract-contacts']).toBe(15);
  });
});
