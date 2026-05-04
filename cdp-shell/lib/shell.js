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
 *  - Explicit URL match ranks highest
 *  - Any linkedin.com page next
 *  - Otherwise the first regular page target
 */
async function findTarget({ host, port, urlMatch }) {
  const targets = await CDP.List({ host, port });
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);

  if (pages.length === 0) {
    throw new Error(
      `No page targets at ${host}:${port}. Is Chrome running with --remote-debugging-port=${port}?`
    );
  }

  if (urlMatch) {
    const exact = pages.find((t) => t.url.includes(urlMatch));
    if (exact) return exact;
  }

  const li = pages.find((t) => /https?:\/\/[^/]*linkedin\.com\//.test(t.url));
  if (li) return li;

  return pages[0];
}

async function readFile(p) {
  return fs.readFile(p, 'utf8');
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
 */
function attachRouter(client) {
  const { Runtime } = client;
  const pendingDeliveries = new Map();
  let nextDeliverId = 1;

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

  // Push storage changes from Node to the page so content/index.js's
  // chrome.storage.onChanged listener (which reloads playbooks/selectors) fires.
  storageApi.onChanged.addListener(async (changes, area) => {
    try {
      await Runtime.evaluate({
        expression:
          `window.__cdpStorageChange && window.__cdpStorageChange(${JSON.stringify(changes)}, ${JSON.stringify(area)})`
      });
    } catch { /* page closed or not yet ready — ignore */ }
  });

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

      Runtime.evaluate({
        expression: `window.__cdpDeliver(${JSON.stringify(msg)}, ${deliverId})`
      }).catch((err) => {
        if (pendingDeliveries.has(deliverId)) {
          pendingDeliveries.delete(deliverId);
          clearTimeout(timer);
          resolve({ error: err.message });
        }
      });
    });
  }

  return { deliver };
}

/**
 * Connect to the running Chrome, attach a router, and inject our content
 * script. Returns a session object exposing run/stop/status methods.
 *
 * @param {Object} [opts]
 * @param {number} [opts.port=9222]
 * @param {string} [opts.urlMatch] — substring URL match for target selection
 */
export async function connect(opts = {}) {
  const host = opts.host || 'localhost';
  const port = opts.port || DEFAULT_PORT;
  const dbg = (m) => process.env.FUSENLINK_DEBUG && console.error(`[shell] ${m}`);

  dbg('ensureInitialized');
  await ensureInitialized();

  dbg('findTarget');
  const target = await findTarget({ host, port, urlMatch: opts.urlMatch });
  console.log(`[shell] target: ${target.url}`);

  // chrome-remote-interface accepts the target's webSocketDebuggerUrl directly,
  // but we also pass host/port so it uses the right connection params.
  dbg('CDP connect');
  const client = await CDP({ host, port, target });
  const { Runtime, Page } = client;
  dbg('Runtime.enable');
  await Runtime.enable();
  dbg('Page.enable');
  await Page.enable();

  // Expose the page→node binding
  dbg('addBinding');
  await Runtime.addBinding({ name: '__cdpSend' });

  const { deliver } = attachRouter(client);

  // Read both scripts off disk
  dbg('reading bridge + bundle from disk');
  const [bridge, bundle] = await Promise.all([
    readFile(PAGE_BRIDGE_PATH),
    readFile(CONTENT_BUNDLE_PATH)
  ]);

  // If persist=true, register the scripts to run on EVERY new document so the
  // bundle (and the in-page Accept All button) survives reloads and SPA
  // navigation, the same way a manifest content_script would in extension mode.
  if (opts.persist) {
    dbg('addScriptToEvaluateOnNewDocument (bridge+bundle persistent)');
    await Page.addScriptToEvaluateOnNewDocument({ source: bridge });
    await Page.addScriptToEvaluateOnNewDocument({ source: bundle });
  }

  dbg('inject bridge (current document)');
  await Runtime.evaluate({ expression: bridge, returnByValue: false });
  dbg('inject bundle (current document)');
  await Runtime.evaluate({ expression: bundle, returnByValue: false });

  dbg('wait 1500ms for boot');
  await new Promise((r) => setTimeout(r, 1500));

  return {
    target,
    client,
    async run(playbookId) {
      const result = await deliver({ type: 'runPlaybook', playbookId });
      return result;
    },
    async stop() {
      const result = await deliver({ type: 'stopPlaybook' });
      return result;
    },
    async status() {
      const result = await deliver({ type: 'getPlaybookStatus' });
      return result;
    },
    async close() {
      try { await client.close(); } catch { /* ignore */ }
    }
  };
}
