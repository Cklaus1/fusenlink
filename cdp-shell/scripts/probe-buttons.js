/**
 * Visit each of the standard LinkedIn pages used by playbooks, inject the
 * bundle, and report which playbook buttons render. Read-only.
 */

import CDP from 'chrome-remote-interface';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../lib/node-chrome-stub.js';
import { route, ensureInitialized } from '../lib/router.js';

const PORT = parseInt(process.argv[2] || '9876', 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const PAGES = [
  { url: 'https://www.linkedin.com/mynetwork/invitation-manager/received/', label: 'Invitation Manager' },
  { url: 'https://www.linkedin.com/search/results/people/?keywords=engineer', label: 'Search Results (people)' },
  { url: 'https://www.linkedin.com/in/chklaus/', label: 'Profile (chklaus)' },
  { url: 'https://www.linkedin.com/feed/', label: 'Feed' },
  { url: 'https://www.linkedin.com/mynetwork/invite-connect/connections/', label: 'Connections' },
  { url: 'https://www.linkedin.com/messaging/', label: 'Messaging (inbox)' },
];

async function main() {
  await ensureInitialized();
  const targets = await CDP.List({ port: PORT });
  const tab = targets.find(t => t.type === 'page' && t.url.includes('linkedin.com'));
  if (!tab) { console.error('No LinkedIn page'); process.exit(1); }

  const c = await CDP({ target: tab });
  await c.Page.enable();
  await c.Runtime.enable();

  const bridge = await fs.readFile(path.join(__dirname, '..', 'lib', 'page-bridge.js'), 'utf8');
  const bundle = await fs.readFile(path.join(REPO_ROOT, 'dist', 'content.bundle.js'), 'utf8');

  const sessionId = Math.random().toString(36).slice(2, 10);
  const bindingName = `__fusenlink_cdpSend_${sessionId}`;
  await c.Runtime.addBinding({ name: bindingName });

  c.on('Runtime.bindingCalled', async ({ name, payload }) => {
    if (name !== bindingName) return;
    let parsed;
    try { parsed = JSON.parse(payload); } catch { return; }
    const { reqId, kind } = parsed;
    if (kind === 'deliverResponse') return;
    let response = null;
    try {
      if (kind === 'sendMessage') response = await route(parsed.msg);
      else if (kind === 'storageGet') response = await new Promise(r => chrome.storage.local.get(parsed.keys, r));
    } catch { response = null; }
    if (reqId) {
      await c.Runtime.evaluate({ expression: `window.__fusenlink_cdpResolve(${reqId}, ${JSON.stringify(response)})` }).catch(() => {});
    }
  });

  function wrap(src) {
    return `try { if (!/^(www\\.)?linkedin\\.com$/i.test(window.location.hostname) || window.top !== window) {} else {
      if (!document.currentScript) { try { Object.defineProperty(document, 'currentScript', { value: { src: location.origin + '/__fusenlink/bundle.js', tagName: 'SCRIPT', getAttribute: () => null }, configurable: true }); } catch (e) {} }
      ${src}
    } } catch (e) {}`;
  }

  console.log('# Button-injection probe — what users see on each page');
  console.log();

  for (const { url, label } of PAGES) {
    const loaded = new Promise(r => c.once('Page.loadEventFired', r));
    await c.Page.navigate({ url });
    await Promise.race([loaded, new Promise(r => setTimeout(r, 8000))]);
    await new Promise(r => setTimeout(r, 2500));

    await c.Runtime.evaluate({ expression: `window.__fusenlink_cdpSendName = ${JSON.stringify(bindingName)};` });
    await c.Runtime.evaluate({ expression: bridge });
    await c.Runtime.evaluate({ expression: wrap(bundle) });
    await new Promise(r => setTimeout(r, 2500));

    const probe = await c.Runtime.evaluate({
      expression: `JSON.stringify({
        url: location.href,
        injected: Array.from(document.querySelectorAll('[data-playbook-injected]')).map(el => ({
          playbookId: el.getAttribute('data-playbook-id'),
          buttons: Array.from(el.querySelectorAll('button')).map(b => b.textContent.trim().slice(0, 40))
        })),
        actionContainer: document.querySelector('.li-bulk-action-buttons') ? Array.from(document.querySelectorAll('.li-bulk-action-buttons button')).map(b => b.textContent.trim()) : []
      })`,
      returnByValue: true
    });
    const r = JSON.parse(probe.result.value);
    console.log(`## ${label}`);
    console.log(`URL: ${r.url}`);
    if (r.actionContainer.length > 0) {
      console.log(`Action container (top-left): ${r.actionContainer.join(', ')}`);
    }
    if (r.injected.length === 0) {
      console.log('Stack: (no buttons injected)');
    } else {
      for (const inj of r.injected) {
        if (inj.playbookId === 'accept-invites' || inj.playbookId === 'deny-invites') continue; // covered by actionContainer
        console.log(`Stack: ${inj.playbookId} → "${inj.buttons.join(', ')}"`);
      }
    }
    console.log();
  }

  await c.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
