/**
 * CDP shell — the orchestrator.
 *
 * 1. Connect to a Chrome already running with --remote-debugging-port=9222.
 * 2. Find the LinkedIn tab (or use the first page target).
 * 3. Inject the page bridge polyfill, then dist/content.bundle.js.
 * 4. Wire bidirectional message routing over CDP's Runtime.addBinding.
 * 5. Expose run() / stop() / getStatus() to the CLI.
 */

import CDP from 'chrome-remote-interface';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { route, ensureInitialized } from './router.js';
import { storageApi } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONTENT_BUNDLE_PATH = path.join(REPO_ROOT, 'dist', 'content.bundle.js');
const PAGE_BRIDGE_PATH = path.join(__dirname, 'page-bridge.js');

const DEFAULT_PORT = 9222;

/**
 * Pick the most appropriate target.
 *  - Explicit tab id prefix wins over everything else
 *  - Explicit URL match next
 *  - Any linkedin.com page next (warn if more than one and no disambiguator)
 *  - Otherwise the first regular page target
 */
async function findTarget({ host, port, urlMatch, tabId }) {
  const targets = await CDP.List({ host, port });
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);

  if (pages.length === 0) {
    throw new Error(
      `No page targets at ${host}:${port}. Is Chrome running with --remote-debugging-port=${port}?`
    );
  }

  if (tabId) {
    const match = pages.find((t) => t.id.startsWith(tabId));
    if (match) return match;
    throw new Error(
      `No target with id starting with "${tabId}". Available: ${pages.map((t) => t.id.slice(0, 8)).join(', ')}`
    );
  }

  if (urlMatch) {
    const exact = pages.find((t) => t.url.includes(urlMatch));
    if (exact) return exact;
  }

  const linkedin = pages.filter((t) => /https?:\/\/[^/]*linkedin\.com\//.test(t.url));
  if (linkedin.length > 1) {
    console.warn(`[shell] WARNING: ${linkedin.length} LinkedIn tabs open; picking the first.`);
    console.warn(`[shell] Disambiguate with --tab-id <prefix> or --url <substring>.`);
    linkedin.forEach((t) => {
      console.warn(`[shell]   id=${t.id.slice(0, 8)}  ${t.url}`);
    });
    return linkedin[0];
  }
  if (linkedin.length === 1) return linkedin[0];

  return pages[0];
}

async function readFile(p) {
  return fs.readFile(p, 'utf8');
}

/**
 * Wrap the bundle source so it only runs in the top-level LinkedIn frame and
 * has a usable document.currentScript shim for webpack's auto publicPath.
 */
function buildWrappedBundle(bundle) {
  return `
    try {
      if (!/(^|\\.)linkedin\\.com$/i.test(window.location.hostname)) {
        // not a linkedin frame — no-op
      } else if (window.top !== window) {
        // same-origin LinkedIn iframe — skip; only the top frame hosts the engine
      } else {
        if (!document.currentScript) {
          try {
            Object.defineProperty(document, 'currentScript', {
              value: {
                src: location.origin + '/__fusenlink/bundle.js',
                tagName: 'SCRIPT',  // webpack reads .tagName.toUpperCase() too
                getAttribute: () => null
              },
              configurable: true
            });
          } catch (e) { /* already defined; ignore */ }
        }
        ${bundle}
      }
    } catch (e) { /* sandboxed iframe or other; bail quietly */ }
  `;
}

/**
 * Set up routing between the page (via __cdpSend binding) and the Node router.
 *
 * Page-side messages travel as JSON-encoded strings:
 *   { reqId, kind: 'sendMessage'|'storageGet'|'storageSet'|'storageRemove'|'deliverResponse', ... }
 *
 * Node-side responses to those calls go through window.__cdpResolve(reqId, response).
 * Node-pushed onMessage deliveries go through window.__cdpDeliver(msg, deliverId)
 * and the page replies with kind: 'deliverResponse'.
 *
 * Returns { deliver, attach(client) } — `attach(client)` rebinds the listeners
 * to a new CDP client (used by the auto-reattach path). Pending deliveries are
 * carried across reconnects so an in-flight playbook can still resolve.
 */
function createRouter() {
  const pendingDeliveries = new Map();
  let nextDeliverId = 1;
  let currentRuntime = null;

  function evaluate(expression) {
    if (!currentRuntime) return Promise.resolve();
    return currentRuntime.evaluate({ expression });
  }

  const storageChangeListener = async (changes, area) => {
    try {
      await evaluate(
        `window.__cdpStorageChange && window.__cdpStorageChange(${JSON.stringify(changes)}, ${JSON.stringify(area)})`
      );
    } catch { /* page closed or not yet ready — ignore */ }
  };
  storageApi.onChanged.addListener(storageChangeListener);

  function attach(client) {
    const { Runtime } = client;
    currentRuntime = Runtime;

    client.on('Runtime.bindingCalled', async ({ name, payload }) => {
      if (name !== '__cdpSend') return;

      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch (err) {
        console.warn('[shell] bad bridge payload:', err.message);
        return;
      }

      const { reqId, kind } = parsed;
      if (process.env.FUSENLINK_DEBUG) {
        const summary = kind === 'sendMessage' ? `action=${parsed.msg?.action}` : '';
        console.error(`[bridge ←] reqId=${reqId} kind=${kind} ${summary}`);
      }

      try {
        if (kind === 'sendMessage') {
          const response = await route(parsed.msg);
          await Runtime.evaluate({
            expression: `window.__cdpResolve(${reqId}, ${JSON.stringify(response ?? null)})`
          });
          return;
        }

        if (kind === 'storageGet') {
          const result = await new Promise((resolve) => storageApi.local.get(parsed.keys, resolve));
          await Runtime.evaluate({
            expression: `window.__cdpResolve(${reqId}, ${JSON.stringify(result)})`
          });
          return;
        }

        if (kind === 'storageSet') {
          await new Promise((resolve) => storageApi.local.set(parsed.items, resolve));
          await Runtime.evaluate({ expression: `window.__cdpResolve(${reqId}, null)` });
          return;
        }

        if (kind === 'storageRemove') {
          await new Promise((resolve) => storageApi.local.remove(parsed.keys, resolve));
          await Runtime.evaluate({ expression: `window.__cdpResolve(${reqId}, null)` });
          return;
        }

        if (kind === 'deliverResponse') {
          const cb = pendingDeliveries.get(parsed.deliverId);
          if (cb) {
            pendingDeliveries.delete(parsed.deliverId);
            cb(parsed.response);
          }
          return;
        }

        console.warn('[shell] unknown bridge kind:', kind);
      } catch (err) {
        // Don't shout about errors that fire after the user-initiated close.
        const isShutdownNoise = /websocket connection closed|target closed|cdp.*closed/i.test(err.message || '');
        if (!isShutdownNoise) {
          console.error('[shell] router error for kind', kind, err.message);
        }
        try {
          await Runtime.evaluate({
            expression: `window.__cdpResolve(${reqId}, ${JSON.stringify({ error: err.message })})`
          });
        } catch { /* page may have navigated */ }
      }
    });
  }

  /**
   * Deliver an onMessage event to all handlers registered in the page,
   * resolving with the first sendResponse callback's value.
   */
  async function deliver(msg) {
    const deliverId = nextDeliverId++;
    return new Promise((resolve) => {
      // 30 minute hard cap — bulk-connect can take a while.
      // unref() so the timer doesn't keep the process alive after a clean response.
      const timer = setTimeout(() => {
        if (pendingDeliveries.has(deliverId)) {
          pendingDeliveries.delete(deliverId);
          resolve({ error: 'deliver timeout' });
        }
      }, 30 * 60 * 1000);
      timer.unref();

      pendingDeliveries.set(deliverId, (response) => {
        clearTimeout(timer);
        resolve(response);
      });

      evaluate(`window.__cdpDeliver(${JSON.stringify(msg)}, ${deliverId})`).catch((err) => {
        if (pendingDeliveries.has(deliverId)) {
          pendingDeliveries.delete(deliverId);
          clearTimeout(timer);
          resolve({ error: err.message });
        }
      });
    });
  }

  function dispose() {
    try { storageApi.onChanged.removeListener(storageChangeListener); }
    catch { /* listener API may not support remove */ }
  }

  return { attach, deliver, dispose };
}

/**
 * Connect to the running Chrome, attach a router, and inject our content
 * script. Returns a session object exposing run/stop/status methods.
 *
 * @param {Object} [opts]
 * @param {string} [opts.host='localhost']
 * @param {number} [opts.port=9222]
 * @param {string} [opts.urlMatch] — substring URL match for target selection
 * @param {string} [opts.tabId] — pick the page target whose id starts with this prefix
 * @param {boolean} [opts.persist=false] — re-inject on every new document
 */
export async function connect(opts = {}) {
  const host = opts.host || 'localhost';
  const port = opts.port || DEFAULT_PORT;
  const dbg = (m) => process.env.FUSENLINK_DEBUG && console.error(`[shell] ${m}`);

  dbg('ensureInitialized');
  await ensureInitialized();

  // State carried across (potential) reconnects.
  const state = {
    host,
    port,
    urlMatch: opts.urlMatch,
    tabId: opts.tabId,
    persist: !!opts.persist,
    sessionAlive: true,
    bridge: null,
    bundle: null,
    wrappedBundle: null,
    client: null,
    target: null,
    reconnecting: false
  };

  dbg('reading bridge + bundle from disk');
  [state.bridge, state.bundle] = await Promise.all([
    readFile(PAGE_BRIDGE_PATH),
    readFile(CONTENT_BUNDLE_PATH)
  ]);
  state.wrappedBundle = buildWrappedBundle(state.bundle);

  const router = createRouter();

  /**
   * Find a target, attach a fresh CDP client, register the binding + listeners,
   * and inject bridge+bundle. Used both for initial connect and for reattach
   * after a target swap.
   */
  async function _connectOnce() {
    dbg('findTarget');
    const target = await findTarget({
      host: state.host,
      port: state.port,
      urlMatch: state.urlMatch,
      tabId: state.tabId
    });
    console.log(`[shell] target: ${target.url}`);

    dbg('CDP connect');
    const client = await CDP({ host: state.host, port: state.port, target });
    const { Runtime, Page } = client;

    dbg('Runtime.enable');
    await Runtime.enable();
    dbg('Page.enable');
    await Page.enable();

    // Expose the page→node binding (must be re-added on every fresh client).
    dbg('addBinding');
    await Runtime.addBinding({ name: '__cdpSend' });

    // Wire (or re-wire) the router to this client.
    router.attach(client);

    if (state.persist) {
      dbg('addScriptToEvaluateOnNewDocument (bridge+bundle persistent)');
      await Page.addScriptToEvaluateOnNewDocument({ source: state.bridge });
      await Page.addScriptToEvaluateOnNewDocument({ source: state.wrappedBundle });
    }

    dbg('inject bridge (current document)');
    await Runtime.evaluate({ expression: state.bridge, returnByValue: false });
    dbg('inject bundle (current document)');
    await Runtime.evaluate({ expression: state.wrappedBundle, returnByValue: false });

    dbg('wait 1500ms for boot');
    await new Promise((r) => setTimeout(r, 1500));

    state.client = client;
    state.target = target;

    // Wire the auto-reattach handler. Chromium swaps target IDs on certain
    // navigations (cross-process, sign-in, etc.); when that happens the WS
    // dies and the bridge is gone. Re-establish on a fresh target.
    client.on('disconnect', () => { _scheduleReattach(); });

    return { client, target };
  }

  function _scheduleReattach() {
    if (!state.sessionAlive) return;
    if (state.reconnecting) return;
    state.reconnecting = true;
    console.log('[shell] target disconnected; reconnecting in 2s...');
    setTimeout(async () => {
      try {
        await _connectOnce();
        console.log('[shell] reattached.');
      } catch (err) {
        console.warn('[shell] reattach failed:', err.message);
        // Try once more after a longer pause if the session is still alive.
        if (state.sessionAlive) {
          setTimeout(() => {
            state.reconnecting = false;
            _scheduleReattach();
          }, 5000).unref();
          return;
        }
      } finally {
        state.reconnecting = false;
      }
    }, 2000).unref();
  }

  await _connectOnce();

  return {
    get target() { return state.target; },
    get client() { return state.client; },
    async run(playbookId) {
      return router.deliver({ type: 'runPlaybook', playbookId });
    },
    async stop() {
      return router.deliver({ type: 'stopPlaybook' });
    },
    async status() {
      return router.deliver({ type: 'getPlaybookStatus' });
    },
    /** Force a reattach (find a new target, re-inject). Exposed for callers. */
    async reattach() {
      try { await state.client?.close(); } catch { /* ignore */ }
      return _connectOnce();
    },
    async close() {
      state.sessionAlive = false;
      router.dispose();
      try { await state.client?.close(); } catch { /* ignore */ }
    }
  };
}
