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

const RETRY_BACKOFF_MIN_MS = 2000;
const RETRY_BACKOFF_MAX_MS = 60000;
const MAX_REATTACH_ATTEMPTS = 30;

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
 * Wrap the bundle source so it only runs in the top-level LinkedIn frame.
 *
 * Defense-in-depth document.currentScript shim: webpack's auto-detection of
 * publicPath used to require this. We now build with `output.publicPath: ''`
 * which disables that auto-detection, so the shim should be unnecessary for
 * fresh bundles. We keep it for backward compatibility with older bundles
 * that might still hit the codepath that reads document.currentScript.
 */
function buildWrappedBundle(bundle) {
  return `
    try {
      // Bug 29 fix: only run on the actual LinkedIn web app hostnames
      // (www.linkedin.com / linkedin.com). Subdomains like ads.linkedin.com,
      // talent.linkedin.com etc. are unrelated surfaces and shouldn't host
      // the bundle.
      if (!/^(www\\.)?linkedin\\.com$/i.test(window.location.hostname)) {
        // not a linkedin frame — no-op
      } else if (window.top !== window) {
        // same-origin LinkedIn iframe — skip; only the top frame hosts the engine
      } else {
        if (!document.currentScript) {
          // Defense-in-depth: webpack 5 with publicPath '' should not need this,
          // but older builds did, so keep the shim for compatibility.
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
 * Set up routing between the page (via __fusenlink_cdpSend binding) and the
 * Node router.
 *
 * Page-side messages travel as JSON-encoded strings:
 *   { reqId, kind: 'sendMessage'|'storageGet'|'storageSet'|'storageRemove'|'deliverResponse', ... }
 *
 * Node-side responses to those calls go through
 * window.__fusenlink_cdpResolve(reqId, response). Node-pushed onMessage
 * deliveries go through window.__fusenlink_cdpDeliver(msg, deliverId) and the
 * page replies with kind: 'deliverResponse'.
 *
 * Returns { deliver, attach(client) } — `attach(client)` rebinds the listeners
 * to a new CDP client (used by the auto-reattach path). Pending deliveries are
 * carried across reconnects so an in-flight playbook can still resolve.
 */
function createRouter({ bindingName = '__fusenlink_cdpSend' } = {}) {
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
        `window.__fusenlink_cdpStorageChange && window.__fusenlink_cdpStorageChange(${JSON.stringify(changes)}, ${JSON.stringify(area)})`
      );
    } catch { /* page closed or not yet ready — ignore */ }
  };
  storageApi.onChanged.addListener(storageChangeListener);

  function attach(client) {
    const { Runtime } = client;
    currentRuntime = Runtime;

    client.on('Runtime.bindingCalled', async ({ name, payload }) => {
      if (name !== bindingName) return;

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
            expression: `window.__fusenlink_cdpResolve(${reqId}, ${JSON.stringify(response ?? null)})`
          });
          return;
        }

        if (kind === 'storageGet') {
          const result = await new Promise((resolve) => storageApi.local.get(parsed.keys, resolve));
          await Runtime.evaluate({
            expression: `window.__fusenlink_cdpResolve(${reqId}, ${JSON.stringify(result)})`
          });
          return;
        }

        if (kind === 'storageSet') {
          await new Promise((resolve) => storageApi.local.set(parsed.items, resolve));
          await Runtime.evaluate({ expression: `window.__fusenlink_cdpResolve(${reqId}, null)` });
          return;
        }

        if (kind === 'storageRemove') {
          await new Promise((resolve) => storageApi.local.remove(parsed.keys, resolve));
          await Runtime.evaluate({ expression: `window.__fusenlink_cdpResolve(${reqId}, null)` });
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
            expression: `window.__fusenlink_cdpResolve(${reqId}, ${JSON.stringify({ error: err.message })})`
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

      evaluate(`window.__fusenlink_cdpDeliver(${JSON.stringify(msg)}, ${deliverId})`).catch((err) => {
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

  return { attach, deliver, dispose, pendingDeliveries };
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

  // Bug 5 fix: scope the page→node binding name to a per-attach session id.
  // Chrome's binding namespace allows multiple Runtime.addBinding registrations
  // for the same name, but only one fires per call — meaning two `attach`
  // processes on the same Chrome would steal each other's bridge messages.
  // A unique name per session keeps each Node↔page channel isolated.
  const sessionId = Math.random().toString(36).slice(2, 10);
  const bindingName = `__fusenlink_cdpSend_${sessionId}`;

  // State carried across (potential) reconnects.
  const state = {
    host,
    port,
    urlMatch: opts.urlMatch,
    tabId: opts.tabId,
    persist: !!opts.persist,
    sessionAlive: true,
    sessionId,
    bindingName,
    bridge: null,
    bundle: null,
    wrappedBundle: null,
    chunkSources: [],
    client: null,
    target: null,
    reconnecting: false,
    reattachAttempts: 0,
    reattachBackoff: RETRY_BACKOFF_MIN_MS,
    // IDs returned by Page.addScriptToEvaluateOnNewDocument. We remove these
    // before re-registering on a reattach so the bridge + bundle don't pile up
    // (every reattach used to register another copy → 10 reattaches = bundle
    // running 10 times per page load). Per-session so multiple sessions sharing
    // a process don't clobber each other.
    registeredScriptIds: []
  };

  dbg('reading bridge + bundle from disk');
  [state.bridge, state.bundle] = await Promise.all([
    readFile(PAGE_BRIDGE_PATH),
    readFile(CONTENT_BUNDLE_PATH)
  ]);
  state.wrappedBundle = buildWrappedBundle(state.bundle);

  // Bug 26 fix: pre-load all webpack split-chunk bundles. With
  // `output.publicPath: ''`, webpack's runtime would otherwise try to fetch
  // chunks from the page origin (404). Pre-evaluating them pushes them into
  // webpack's registry so dynamic imports inside content.bundle.js find them
  // already loaded. We exclude entry points for other extension surfaces
  // (background/options/popup) and the content entry itself.
  const distDir = path.dirname(CONTENT_BUNDLE_PATH);
  const skipEntries = new Set([
    'content.bundle.js',
    'background.bundle.js',
    'options.bundle.js',
    'popup.bundle.js'
  ]);
  try {
    const distFiles = await fs.readdir(distDir);
    const chunkFiles = distFiles
      .filter((f) => f.endsWith('.bundle.js') && !skipEntries.has(f))
      .sort();
    state.chunkSources = await Promise.all(
      chunkFiles.map(async (name) => {
        const source = await readFile(path.join(distDir, name));
        return { name, wrapped: buildWrappedBundle(source) };
      })
    );
    if (state.chunkSources.length) {
      dbg(`loaded ${state.chunkSources.length} chunk bundle(s): ${state.chunkSources.map((c) => c.name).join(', ')}`);
    }
  } catch (err) {
    dbg(`could not enumerate dist chunks: ${err.message}`);
    state.chunkSources = [];
  }

  const router = createRouter({ bindingName });
  // Expose to outer state so reattach give-up logic can reject pending
  // deliveries (Bug 15 fix).
  state.pendingDeliveries = router.pendingDeliveries;

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
    // Bug 5 fix: use a session-scoped binding name so multiple shells driving
    // the same Chrome don't clobber each other.
    dbg(`addBinding (${bindingName})`);
    await Runtime.addBinding({ name: bindingName });

    // Wire (or re-wire) the router to this client.
    router.attach(client);

    // Tell the page bridge which binding name to dispatch through. This must
    // be evaluated BEFORE the bridge runs (and re-registered on every new
    // document when persistent) so the bridge can pick up the right function.
    const prelude = `window.__fusenlink_cdpSendName = ${JSON.stringify(bindingName)};`;

    if (state.persist) {
      // Remove any previously registered persistent scripts. Without this,
      // every reattach piles on another copy — after N reattaches, the bridge
      // and bundle run N+1 times on every page load.
      // Bug 24 fix: only clear IDs that successfully removed; keep failures
      // so we know what's still registered and can retry later.
      const remainingIds = [];
      for (const id of state.registeredScriptIds) {
        try {
          await Page.removeScriptToEvaluateOnNewDocument({ identifier: id });
        } catch {
          // Removal failed — script may still be registered. Keep the id so
          // we don't lose track of stale registrations.
          remainingIds.push(id);
        }
      }
      state.registeredScriptIds = remainingIds;

      dbg('addScriptToEvaluateOnNewDocument (prelude+bridge+chunks+bundle persistent)');
      // Prelude must run before the bridge so the bridge sees the binding name.
      const r0 = await Page.addScriptToEvaluateOnNewDocument({ source: prelude });
      state.registeredScriptIds.push(r0.identifier);
      const r1 = await Page.addScriptToEvaluateOnNewDocument({ source: state.bridge });
      state.registeredScriptIds.push(r1.identifier);
      // Pre-register all webpack chunk bundles before the entry, so dynamic
      // imports inside content.bundle.js find them already in the registry.
      for (const chunk of state.chunkSources) {
        const rChunk = await Page.addScriptToEvaluateOnNewDocument({ source: chunk.wrapped });
        state.registeredScriptIds.push(rChunk.identifier);
      }
      const r2 = await Page.addScriptToEvaluateOnNewDocument({ source: state.wrappedBundle });
      state.registeredScriptIds.push(r2.identifier);
    }

    dbg('inject prelude (current document)');
    await Runtime.evaluate({ expression: prelude, returnByValue: false });
    dbg('inject bridge (current document)');
    await Runtime.evaluate({ expression: state.bridge, returnByValue: false });
    // Bug 26 fix: pre-evaluate all webpack chunks before the entry bundle so
    // webpack's chunk-loading runtime finds them already loaded (no fetch
    // round-trip to a 404 from publicPath:'').
    for (const chunk of state.chunkSources) {
      dbg(`inject chunk ${chunk.name} (current document)`);
      await Runtime.evaluate({ expression: chunk.wrapped, returnByValue: false });
    }
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
    // Bug 11 fix: bound the retry count and use exponential backoff so the
    // reattach loop doesn't fire forever when the target permanently
    // disappears (sign-out, login page, etc.).
    if (state.reattachAttempts >= MAX_REATTACH_ATTEMPTS) {
      console.warn(`[shell] Reattach gave up after ${MAX_REATTACH_ATTEMPTS} attempts. Use 'attach' command to retry manually.`);
      state.sessionAlive = false;
      // Bug 15 fix: reject any pending deliveries so callers don't hang
      // forever waiting for a response from a page that's never coming back.
      if (state.pendingDeliveries) {
        for (const cb of state.pendingDeliveries.values()) {
          try { cb({ error: 'session_disconnected: reattach with attach command' }); } catch { /* ignore */ }
        }
        state.pendingDeliveries.clear();
      }
      return;
    }
    state.reconnecting = true;
    state.reattachAttempts++;
    const delay = state.reattachBackoff;
    console.log(`[shell] target disconnected; reconnecting in ${Math.round(delay / 1000)}s (attempt ${state.reattachAttempts}/${MAX_REATTACH_ATTEMPTS})...`);
    setTimeout(async () => {
      try {
        await _connectOnce();
        console.log('[shell] reattached.');
        // Success — reset bounded-retry state.
        state.reattachAttempts = 0;
        state.reattachBackoff = RETRY_BACKOFF_MIN_MS;
      } catch (err) {
        console.warn(`[shell] reattach attempt ${state.reattachAttempts} failed: ${err.message}`);
        // Exponential backoff capped at RETRY_BACKOFF_MAX_MS.
        state.reattachBackoff = Math.min(state.reattachBackoff * 2, RETRY_BACKOFF_MAX_MS);
        if (state.sessionAlive) {
          state.reconnecting = false;
          _scheduleReattach();
          return;
        }
      } finally {
        state.reconnecting = false;
      }
    }, delay).unref();
  }

  await _connectOnce();

  return {
    get target() { return state.target; },
    get client() { return state.client; },
    async run(playbookId) {
      // Bug 15 fix: short-circuit when the session is known-dead so commands
      // surface a clear error instead of hanging on a vanished page.
      if (!state.sessionAlive) {
        return { error: 'Session disconnected. Run `fusenlink-cdp attach` to re-establish.' };
      }
      return router.deliver({ type: 'runPlaybook', playbookId });
    },
    async stop() {
      if (!state.sessionAlive) {
        return { error: 'Session disconnected. Run `fusenlink-cdp attach` to re-establish.' };
      }
      return router.deliver({ type: 'stopPlaybook' });
    },
    async status() {
      if (!state.sessionAlive) {
        return { error: 'Session disconnected. Run `fusenlink-cdp attach` to re-establish.' };
      }
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
