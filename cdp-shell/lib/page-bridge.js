/**
 * Page-side polyfill that mimics the chrome.* surfaces the content bundle
 * uses, then routes traffic through CDP's __cdpSend binding to the Node
 * shell.
 *
 * This file is read as a string and evaluated in the target page BEFORE
 * dist/content.bundle.js is loaded. It exposes:
 *
 *   - chrome.runtime.sendMessage(msg, cb)  → routed to Node via __cdpSend
 *   - chrome.runtime.onMessage.addListener  → fired by window.__cdpDeliver(...)
 *   - chrome.storage.local                 → routed to Node
 *   - chrome.storage.onChanged             → fired by window.__cdpStorageChange(...)
 *   - chrome.alarms                        → no-op (no scheduling in shell mode)
 *
 * Bidirectional protocol over __cdpSend:
 *   page → node:  { kind: 'sendMessage'|'storageGet'|...|'deliverResponse', reqId, ...payload }
 *   node → page:  window.__cdpResolve(reqId, response)  for sendMessage/storage replies
 *                 window.__cdpDeliver(msg, deliverId)   to fire onMessage handlers
 */

(function bridge() {
  if (window.__fusenlinkBridgeInstalled) return;
  window.__fusenlinkBridgeInstalled = true;

  const pending = new Map();
  let nextReqId = 1;

  function send(payload) {
    const reqId = nextReqId++;
    return new Promise((resolve) => {
      pending.set(reqId, resolve);
      // __cdpSend is added via Runtime.addBinding by the Node shell
      // It accepts a single string argument
      __cdpSend(JSON.stringify({ reqId, ...payload }));
    });
  }

  window.__cdpResolve = (reqId, response) => {
    const cb = pending.get(reqId);
    if (cb) {
      pending.delete(reqId);
      cb(response);
    }
  };

  // chrome.runtime.onMessage handlers — fired by Node via __cdpDeliver
  const onMessageHandlers = [];
  window.__cdpDeliver = (msg, deliverId) => {
    if (onMessageHandlers.length === 0) {
      // No handler registered yet — reply with no-op
      __cdpSend(JSON.stringify({ kind: 'deliverResponse', deliverId, response: null }));
      return;
    }
    let responded = false;
    const sendResponse = (data) => {
      if (responded) return;
      responded = true;
      __cdpSend(JSON.stringify({ kind: 'deliverResponse', deliverId, response: data }));
    };
    // Fire only the first handler that returns truthy (matching Chrome semantics:
    // multiple listeners can each handle, but we only need one response).
    for (const h of onMessageHandlers) {
      try {
        const ret = h(msg, null, sendResponse);
        if (ret === true) {
          // Async response — wait for sendResponse to be called
          return;
        }
      } catch (err) {
        console.error('[bridge] onMessage handler error:', err);
      }
    }
    // If no handler returned true and none called sendResponse, send null
    if (!responded) sendResponse(null);
  };

  // chrome.storage.onChanged — fired by Node via __cdpStorageChange
  const storageListeners = [];
  window.__cdpStorageChange = (changes, area) => {
    for (const cb of storageListeners) {
      try { cb(changes, area); } catch (err) { console.error('[bridge] storage listener error:', err); }
    }
  };

  // Polyfilled chrome.* surfaces
  if (!window.chrome) window.chrome = {};

  window.chrome.runtime = {
    sendMessage: (msg, cb) => {
      send({ kind: 'sendMessage', msg }).then((response) => {
        if (typeof cb === 'function') cb(response);
      });
    },
    onMessage: {
      addListener: (h) => onMessageHandlers.push(h),
      removeListener: (h) => {
        const i = onMessageHandlers.indexOf(h);
        if (i >= 0) onMessageHandlers.splice(i, 1);
      }
    },
    lastError: null,
    getManifest: () => ({ version: '2.0.0-cdp', name: 'FusenLink CDP' })
  };

  window.chrome.storage = {
    local: {
      get: (keys, cb) => {
        send({ kind: 'storageGet', keys }).then((result) => cb && cb(result || {}));
      },
      set: (items, cb) => {
        send({ kind: 'storageSet', items }).then(() => cb && cb());
      },
      remove: (keys, cb) => {
        send({ kind: 'storageRemove', keys }).then(() => cb && cb());
      }
    },
    onChanged: {
      addListener: (cb) => storageListeners.push(cb)
    }
  };

  // alarms — no-op. The shell runs single playbook invocations; periodic
  // execution belongs to a future scheduler that lives in Node.
  window.chrome.alarms = {
    create: () => {},
    clear: () => {},
    get: (_n, cb) => cb && cb(null),
    onAlarm: { addListener: () => {} }
  };

  // tabs — content scripts don't normally use this, but polyfill the shape
  // just in case. Empty results everywhere.
  window.chrome.tabs = {
    query: (_q, cb) => cb && cb([]),
    sendMessage: () => {}
  };

  console.log('[fusenlink-cdp] page bridge installed');
})();
