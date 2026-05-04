import CDP from 'chrome-remote-interface';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const PORT = parseInt(process.argv[2] || '9876', 10);
const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const targets = await CDP.List({ port: PORT });
const tab = targets.find(t => t.type === 'page' && t.url.includes('linkedin.com'))
         || targets.find(t => t.type === 'page');
console.log('target:', tab.url);

const client = await CDP({ target: tab });
const { Runtime } = client;
await Runtime.enable();

client.on('Runtime.consoleAPICalled', (e) => {
  const args = e.args.map(a => a.value !== undefined ? a.value : a.description).join(' ');
  console.log(`[page ${e.type}]`, args.slice(0, 200));
});
client.on('Runtime.exceptionThrown', (e) => {
  console.log('[page error]', e.exceptionDetails.text, e.exceptionDetails.exception?.description?.slice(0, 200));
});

await Runtime.addBinding({ name: '__cdpSend' });
client.on('Runtime.bindingCalled', (e) => {
  if (e.name === '__cdpSend') {
    const p = e.payload.slice(0, 200);
    console.log('[binding →]', p);
  }
});

const bridge = await fs.readFile(path.join(import.meta.dirname, 'lib/page-bridge.js'), 'utf8');
const bundle = await fs.readFile(path.join(REPO_ROOT, 'dist/content.bundle.js'), 'utf8');

console.log('--- inject bridge ---');
const r1 = await Runtime.evaluate({ expression: bridge });
if (r1.exceptionDetails) console.log('bridge exception:', r1.exceptionDetails.text);

const r2 = await Runtime.evaluate({ expression: 'typeof __cdpSend + " | chrome.runtime: " + typeof chrome.runtime.sendMessage', returnByValue: true });
console.log('polyfill present:', r2.result.value);

console.log('--- inject bundle ---');
const r3 = await Runtime.evaluate({ expression: bundle });
if (r3.exceptionDetails) {
  console.log('bundle exception:', r3.exceptionDetails.text);
  console.log('  details:', r3.exceptionDetails.exception?.description?.slice(0, 500));
}

await new Promise(r => setTimeout(r, 2500));

const r4 = await Runtime.evaluate({
  expression: 'JSON.stringify({ bridge: !!window.__fusenlinkBridgeInstalled, ready: window.__cdpReady, deliverFn: typeof window.__cdpDeliver, chromeKeys: Object.keys(chrome || {}).join(",") })',
  returnByValue: true
});
console.log('post-bundle state:', r4.result.value);

console.log('--- attempting deliver getPlaybookStatus ---');
const r5 = await Runtime.evaluate({
  expression: `(function() {
    let resolved = null;
    window.__cdpDeliver({type: 'getPlaybookStatus'}, 9999);
    return 'delivered';
  })()`,
  returnByValue: true
});
console.log('deliver call:', r5.result.value);

await new Promise(r => setTimeout(r, 3000));
console.log('--- done ---');
await client.close();
