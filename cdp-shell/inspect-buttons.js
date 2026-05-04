/**
 * Diagnostic: connect to the running Chromium via CDP, visit both
 * /mynetwork/ (the "grow" page) and /mynetwork/invitation-manager/received/,
 * inject the bundle, and report which buttons the button-injector chose to
 * render on each. Captures screenshots for visual confirmation.
 *
 * Usage:  node inspect-buttons.js [port=9876]
 */

import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const PORT = parseInt(process.argv[2] || '9876', 10);
const REPO_ROOT = path.resolve(import.meta.dirname, '..');

// Minimal page-side polyfill — no Node bridge needed for this read-only test.
// Just makes chrome.runtime / chrome.storage no-op so the bundle loads and
// uses DEFAULT_PLAYBOOKS / DEFAULT_SETTINGS as fallbacks.
const POLYFILL = `
  if (!window.chrome) window.chrome = {};
  window.chrome.runtime = {
    sendMessage: (msg, cb) => { if (typeof cb === 'function') cb(null); },
    onMessage: { addListener: () => {}, removeListener: () => {} },
    lastError: null,
    getManifest: () => ({ version: '2.0.0-inspect' })
  };
  window.chrome.storage = {
    local: {
      get: (keys, cb) => cb && cb({}),
      set: (items, cb) => cb && cb(),
      remove: (keys, cb) => cb && cb()
    },
    onChanged: { addListener: () => {} }
  };
  window.chrome.alarms = {
    create: () => {}, clear: () => {}, get: (_n, cb) => cb && cb(null),
    onAlarm: { addListener: () => {} }
  };
  window.chrome.tabs = {
    query: (_q, cb) => cb && cb([]),
    sendMessage: () => {}
  };
  console.log('[inspect] polyfill installed');
`;

const bundle = await fs.readFile(path.join(REPO_ROOT, 'dist/content.bundle.js'), 'utf8');

console.log(`[inspect] connecting to CDP on localhost:${PORT}...`);
const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
const contexts = browser.contexts();
const ctx = contexts[0];
const pages = ctx.pages();
const page = pages.find(p => p.url().includes('linkedin.com')) || pages[0];

console.log(`[inspect] using page: ${page.url()}`);

async function inspectAt(url) {
  console.log(`\n=== ${url} ===`);

  // Navigate; wait for network idle so content has had a chance to render.
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  console.log(`[inspect] settled at: ${page.url()}`);

  // Forward page console.log so we can see what the bundle prints
  const onConsole = (msg) => {
    const t = msg.text();
    if (t.includes('[inspect]') || t.includes('FusenLink') || t.includes('PlaybookEngine') || t.includes('SelectorResolver') || t.includes('ContentBridge')) {
      console.log(`[page]`, t.slice(0, 200));
    }
  };
  page.on('console', onConsole);

  // Inject polyfill + bundle
  await page.evaluate(POLYFILL);
  await page.evaluate(bundle);

  // boot() runs DOMContentLoaded handler → loadData() → injectForCurrentPage()
  // Give it 2s to finish.
  await page.waitForTimeout(2000);

  // Now inspect the DOM for what button-injector rendered
  const buttonState = await page.evaluate(() => {
    const stack = document.getElementById('li-bulk-button-stack');
    const allInjected = Array.from(document.querySelectorAll('[data-playbook-injected]'));
    const actionContainer = document.querySelector('.li-bulk-action-buttons');

    return {
      stackPresent: !!stack,
      stackVisible: stack ? stack.getBoundingClientRect().width > 0 : false,
      injectedCount: allInjected.length,
      injectedIds: allInjected.map(el => el.getAttribute('data-playbook-id')),
      actionContainerPresent: !!actionContainer,
      actionButtonsText: actionContainer
        ? Array.from(actionContainer.querySelectorAll('button')).map(b => b.textContent)
        : [],
      // Check what the bundle's injectButtons would have evaluated:
      pageUrl: window.location.href,
      // Sanity: did the bundle load at all?
      bundleLoaded: typeof window.__fusenlinkBridgeInstalled === 'undefined'
        ? 'no-bridge' // expected for this test, the polyfill set chrome but no bridge mark
        : 'bridge-marked'
    };
  });

  console.log('[inspect] DOM result:', JSON.stringify(buttonState, null, 2));

  // Also: ask the bundle which playbooks would have matched this URL.
  // We can't easily inspect the bundle's internal closure, so re-derive
  // from defaults by reading them straight off disk.
  const matchSummary = await page.evaluate(() => window.location.href);
  console.log(`[inspect] href: ${matchSummary}`);

  page.off('console', onConsole);

  // Screenshot the bottom-left corner where buttons would land
  const shot = `/tmp/fusenlink-${url.includes('invitation-manager') ? 'invman' : 'grow'}.png`;
  await page.screenshot({ path: shot, fullPage: false });
  console.log(`[inspect] screenshot: ${shot}`);
}

await inspectAt('https://www.linkedin.com/mynetwork/');
await inspectAt('https://www.linkedin.com/mynetwork/invitation-manager/received/');

// Summarize which playbooks SHOULD match each URL by checking the source defaults
console.log('\n=== expected matches per URL (from src/defaults/playbooks.js) ===');
const playbooksSrc = await fs.readFile(path.join(REPO_ROOT, 'src/defaults/playbooks.js'), 'utf8');
const idAndPattern = [...playbooksSrc.matchAll(/'([\w-]+)':\s*\{[\s\S]{0,400}?urlPattern:\s*'([^']+)'/g)];
for (const url of ['https://www.linkedin.com/mynetwork/', 'https://www.linkedin.com/mynetwork/invitation-manager/received/']) {
  console.log(`\n${url}`);
  for (const [, id, pattern] of idAndPattern) {
    let r;
    try { r = new RegExp(pattern); } catch { continue; }
    if (r.test(url)) console.log(`  ✓ ${id}  (urlPattern: ${pattern})`);
  }
}

await browser.close();
process.exit(0);
