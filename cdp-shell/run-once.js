/**
 * Minimal one-shot runner — exercises the full bridge end-to-end without
 * the CLI's wrapper layer. Useful for diagnosing where the shell.js path
 * differs from debug.js.
 *
 * Usage:  node run-once.js <playbook-id> [port]
 */

import './lib/node-chrome-stub.js';
import CDP from 'chrome-remote-interface';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { route, ensureInitialized } from './lib/router.js';
import { storageApi } from './lib/storage.js';

const PLAYBOOK = process.argv[2] || 'accept-invites';
const PORT = parseInt(process.argv[3] || '9876', 10);

console.log(`[run] playbook=${PLAYBOOK} port=${PORT}`);

await ensureInitialized();

const targets = await CDP.List({ port: PORT });
const tab = targets.find(t => t.type === 'page' && t.url.includes('linkedin.com'))
         || targets.find(t => t.type === 'page');
console.log(`[run] target: ${tab.url}`);

const client = await CDP({ target: tab });
const { Runtime } = client;
await Runtime.enable();

client.on('Runtime.consoleAPICalled', (e) => {
  const args = e.args.map(a => a.value !== undefined ? a.value : a.description).join(' ');
  if (!args.includes('[fusenlink-cdp]')) return; // only show our bridge logs to keep it tidy
  console.log(`[page]`, args.slice(0, 200));
});
client.on('Runtime.exceptionThrown', (e) => {
  console.log('[page error]', e.exceptionDetails.text);
});

await Runtime.addBinding({ name: '__cdpSend' });

const pendingDelivers = new Map();
let nextDeliver = 1;

client.on('Runtime.bindingCalled', async ({ name, payload }) => {
  if (name !== '__cdpSend') return;
  let parsed;
  try { parsed = JSON.parse(payload); } catch { return; }
  const { reqId, kind } = parsed;

  if (kind === 'deliverResponse') {
    const cb = pendingDelivers.get(parsed.deliverId);
    if (cb) { pendingDelivers.delete(parsed.deliverId); cb(parsed.response); }
    return;
  }

  console.log(`[bridge ←] reqId=${reqId} kind=${kind}${kind === 'sendMessage' ? ' action=' + parsed.msg?.action : ''}`);

  let response;
  try {
    if (kind === 'sendMessage')         response = await route(parsed.msg);
    else if (kind === 'storageGet')     response = await new Promise(r => storageApi.local.get(parsed.keys, r));
    else if (kind === 'storageSet')   { await new Promise(r => storageApi.local.set(parsed.items, r)); response = null; }
    else if (kind === 'storageRemove'){ await new Promise(r => storageApi.local.remove(parsed.keys, r)); response = null; }
    else { console.warn('[bridge] unknown kind:', kind); response = null; }
  } catch (err) {
    console.error('[bridge] error:', err.message);
    response = { error: err.message };
  }

  await Runtime.evaluate({
    expression: `window.__cdpResolve(${reqId}, ${JSON.stringify(response ?? null)})`
  }).catch(() => {});
});

const bridge = await fs.readFile(path.join(import.meta.dirname, 'lib/page-bridge.js'), 'utf8');
const bundle = await fs.readFile(path.resolve(import.meta.dirname, '..', 'dist/content.bundle.js'), 'utf8');

console.log('[run] inject bridge');
await Runtime.evaluate({ expression: bridge });

console.log('[run] inject content bundle');
await Runtime.evaluate({ expression: bundle });

console.log('[run] waiting 2s for boot...');
await new Promise(r => setTimeout(r, 2000));

function deliver(msg) {
  const id = nextDeliver++;
  return new Promise((resolve) => {
    pendingDelivers.set(id, resolve);
    Runtime.evaluate({
      expression: `window.__cdpDeliver(${JSON.stringify(msg)}, ${id})`
    });
    setTimeout(() => {
      if (pendingDelivers.has(id)) { pendingDelivers.delete(id); resolve({ error: 'timeout' }); }
    }, 600000);  // 10min
  });
}

console.log(`[run] ▶ delivering runPlaybook ${PLAYBOOK}`);
const start = Date.now();
const result = await deliver({ type: 'runPlaybook', playbookId: PLAYBOOK });
console.log(`[run] ✓ done in ${((Date.now()-start)/1000).toFixed(1)}s:`);
console.log(JSON.stringify(result, null, 2));

await client.close();
process.exit(0);
