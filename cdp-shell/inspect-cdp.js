/**
 * Same diagnostic as inspect-buttons.js, but using ONLY chrome-remote-interface.
 * No Playwright. Demonstrates Page.captureScreenshot for the screenshot bit.
 *
 * Usage:  node inspect-cdp.js [port=9876]
 */

import CDP from 'chrome-remote-interface';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const PORT = parseInt(process.argv[2] || '9876', 10);
const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const POLYFILL = `
  if (!window.chrome) window.chrome = {};
  window.chrome.runtime = {
    sendMessage: (m, cb) => { if (typeof cb === 'function') cb(null); },
    onMessage: { addListener: () => {}, removeListener: () => {} },
    lastError: null, getManifest: () => ({ version: '2.0.0-inspect' })
  };
  window.chrome.storage = {
    local: { get: (k, cb) => cb && cb({}), set: (i, cb) => cb && cb(), remove: (k, cb) => cb && cb() },
    onChanged: { addListener: () => {} }
  };
  window.chrome.alarms = { create:()=>{}, clear:()=>{}, get:(_,cb)=>cb&&cb(null), onAlarm:{addListener:()=>{}} };
  window.chrome.tabs = { query: (_,cb)=>cb&&cb([]), sendMessage: ()=>{} };
`;

const bundle = await fs.readFile(path.join(REPO_ROOT, 'dist/content.bundle.js'), 'utf8');

console.log(`[inspect] connecting to CDP on localhost:${PORT}...`);
const targets = await CDP.List({ port: PORT });
const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('linkedin.com'))
                || targets.find(t => t.type === 'page');

const client = await CDP({ target: pageTarget });
const { Page, Runtime } = client;
await Page.enable();
await Runtime.enable();

console.log(`[inspect] using target: ${pageTarget.url}`);

async function inspectAt(url, label) {
  console.log(`\n=== ${url} ===`);

  // Navigate. CDP's Page.navigate doesn't wait by default; we listen for loadEventFired.
  // chrome-remote-interface emits domain events on the top-level client, not on the domain.
  const loaded = new Promise((r) => client.once('Page.loadEventFired', r));
  await Page.navigate({ url });
  await loaded;
  await new Promise((r) => setTimeout(r, 1500));

  // Inject polyfill + bundle
  await Runtime.evaluate({ expression: POLYFILL });
  await Runtime.evaluate({ expression: bundle });

  // Let boot() / button-injector run
  await new Promise((r) => setTimeout(r, 2000));

  const inspectScript = `(function() {
    const stack = document.getElementById('li-bulk-button-stack');
    const all = Array.from(document.querySelectorAll('[data-playbook-injected]'));
    const action = document.querySelector('.li-bulk-action-buttons');
    return JSON.stringify({
      url: location.href,
      injectedIds: all.map(e => e.getAttribute('data-playbook-id')),
      stackPresent: !!stack,
      actionContainerPresent: !!action,
      actionButtons: action
        ? Array.from(action.querySelectorAll('button')).map(b => b.textContent)
        : []
    });
  })()`;

  const { result } = await Runtime.evaluate({
    expression: inspectScript,
    returnByValue: true
  });
  console.log('[inspect]', result.value);

  // ── CDP-native screenshot (no Playwright) ──
  const { data } = await Page.captureScreenshot({ format: 'png' });
  const out = `/tmp/fusenlink-cdp-${label}.png`;
  await fs.writeFile(out, Buffer.from(data, 'base64'));
  const stat = await fs.stat(out);
  console.log(`[inspect] screenshot: ${out} (${(stat.size / 1024).toFixed(1)} KB)`);
}

await inspectAt('https://www.linkedin.com/mynetwork/', 'grow');
await inspectAt('https://www.linkedin.com/mynetwork/invitation-manager/received/', 'invman');

await client.close();
process.exit(0);
