// Helper to inspect DOM at a given URL via CDP
import CDP from 'chrome-remote-interface';

const PORT = parseInt(process.argv[2] || '9876', 10);
const URL = process.argv[3];
const SCRIPT = process.argv[4]; // a JS expression that returns JSON

const targets = await CDP.List({ port: PORT });
const tab = targets.find(t => t.type === 'page' && t.url.includes('linkedin.com'))
         || targets.find(t => t.type === 'page');
if (!tab) { console.error('No page target'); process.exit(1); }

const client = await CDP({ target: tab });
const { Runtime, Page } = client;
await Runtime.enable();
await Page.enable();

if (URL && URL !== 'CURRENT') {
  const loaded = new Promise(r => client.once('Page.loadEventFired', r));
  await Page.navigate({ url: URL });
  await Promise.race([loaded, new Promise(r => setTimeout(r, 15000))]);
  await new Promise(r => setTimeout(r, 3000));
}

const r = await Runtime.evaluate({ expression: SCRIPT, returnByValue: true });
console.log(JSON.stringify(r.result.value, null, 2));
await client.close();
process.exit(0);
