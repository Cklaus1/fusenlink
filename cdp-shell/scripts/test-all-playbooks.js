/**
 * READ-ONLY playbook test harness.
 *
 * For every playbook in the engine:
 * 1. Navigate Chrome to a URL matching its urlPattern (best-guess).
 * 2. Inject the page bridge + content bundle.
 * 3. Probe the page: which selectors from its registry actually match? How many?
 * 4. Screenshot.
 * 5. Write a per-playbook report.
 *
 * Does NOT click buttons or write data. Does NOT modify the user's LinkedIn state.
 *
 * Usage:  node scripts/test-all-playbooks.js [port=9876]
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
const REPORT_DIR = '/tmp/fusenlink-playbook-tests';

// Best-guess URL per urlPattern. For patterns matching multiple URLs,
// pick a representative concrete URL.
function chooseUrlFor(pattern) {
  if (pattern.includes('mynetwork/invitation-manager')) return 'https://www.linkedin.com/mynetwork/invitation-manager/received/';
  if (pattern.includes('search/results/people')) return 'https://www.linkedin.com/search/results/people/?keywords=engineer';
  if (pattern.includes('search/results')) return 'https://www.linkedin.com/search/results/people/?keywords=engineer';
  if (pattern.includes('mynetwork/invite-connect/connections')) return 'https://www.linkedin.com/mynetwork/invite-connect/connections/';
  if (pattern.includes('messaging')) return 'https://www.linkedin.com/messaging/';
  if (pattern.includes('feed/update') || pattern.includes('posts')) {
    // Need a real post URL — use a canonical LinkedIn post we can visit
    // Skip — test harness will note "no post URL available"
    return null;
  }
  if (pattern.includes('feed')) return 'https://www.linkedin.com/feed/';
  if (pattern.match(/\\\.com\/$/)) return 'https://www.linkedin.com/';
  // Default: linkedin.com root
  return 'https://www.linkedin.com/';
}

async function main() {
  await ensureInitialized();
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const playbooks = await route({ action: 'getAllPlaybooks' });
  const allRegistries = await new Promise(r => chrome.storage.local.get('selectors', x => r(x.selectors || {})));

  console.log(`[test] ${Object.keys(playbooks).length} playbooks to test`);
  console.log(`[test] ${Object.keys(allRegistries).length} selector registries loaded`);
  console.log(`[test] reports → ${REPORT_DIR}`);

  // Connect to Chrome
  const targets = await CDP.List({ port: PORT });
  const tab = targets.find(t => t.type === 'page' && t.url.includes('linkedin.com'))
           || targets.find(t => t.type === 'page');
  if (!tab) {
    console.error('No page target found on Chrome:9876');
    process.exit(1);
  }
  console.log(`[test] using target: ${tab.url}`);

  const client = await CDP({ target: tab });
  const { Runtime, Page } = client;
  await Runtime.enable();
  await Page.enable();

  // Read bridge + bundle once
  const bridge = await fs.readFile(path.join(__dirname, '..', 'lib', 'page-bridge.js'), 'utf8');
  const bundleSrc = await fs.readFile(path.join(REPO_ROOT, 'dist', 'content.bundle.js'), 'utf8');

  // Pre-inject all sibling chunks (excluding the entry bundles for other contexts)
  const distDir = path.join(REPO_ROOT, 'dist');
  const allFiles = await fs.readdir(distDir);
  const sideChunks = allFiles.filter(f =>
    f.endsWith('.bundle.js') &&
    !['content.bundle.js', 'background.bundle.js', 'options.bundle.js', 'popup.bundle.js'].includes(f)
  );

  function wrapBundle(src) {
    return `try {
      if (!/^(www\\.)?linkedin\\.com$/i.test(window.location.hostname)) {}
      else if (window.top !== window) {}
      else {
        if (!document.currentScript) {
          try {
            Object.defineProperty(document, 'currentScript', {
              value: { src: location.origin + '/__fusenlink/bundle.js', tagName: 'SCRIPT', getAttribute: () => null },
              configurable: true
            });
          } catch (e) {}
        }
        ${src}
      }
    } catch (e) {}`;
  }

  // Set up a minimal __fusenlink_cdpSend binding so the bundle's chrome.runtime.sendMessage doesn't hang
  const sessionId = Math.random().toString(36).slice(2, 10);
  const bindingName = `__fusenlink_cdpSend_${sessionId}`;
  await Runtime.addBinding({ name: bindingName });

  // Respond to all bridge calls with sane defaults so the bundle proceeds
  client.on('Runtime.bindingCalled', async ({ name, payload }) => {
    if (name !== bindingName) return;
    let parsed;
    try { parsed = JSON.parse(payload); } catch { return; }
    const { reqId, kind } = parsed;
    if (kind === 'deliverResponse') return;
    let response = null;
    try {
      if (kind === 'sendMessage') {
        response = await route(parsed.msg);
      } else if (kind === 'storageGet') {
        response = await new Promise(r => chrome.storage.local.get(parsed.keys, r));
      } else if (kind === 'storageSet' || kind === 'storageRemove') {
        // No-op for tests; we don't want to mutate user's storage
        response = null;
      }
    } catch (err) {
      response = { error: err.message };
    }
    if (reqId) {
      await Runtime.evaluate({ expression: `window.__fusenlink_cdpResolve(${reqId}, ${JSON.stringify(response)})` })
        .catch(() => {});
    }
  });

  const results = [];
  let testIdx = 0;

  for (const [id, pb] of Object.entries(playbooks)) {
    testIdx++;
    const result = {
      id,
      version: pb.version,
      trustLevel: pb.trustLevel || 'auto',
      requiresAI: !!pb.settings?.requiresAI,
      urlPattern: pb.urlPattern,
      selectorsKey: pb.selectors,
      stepsCount: (pb.steps || []).length,
    };

    console.log(`\n[${testIdx}/${Object.keys(playbooks).length}] ${id}`);

    // 1. Static checks
    let pattern;
    try {
      pattern = new RegExp(pb.urlPattern);
      result.urlPatternValid = true;
    } catch {
      result.urlPatternValid = false;
      result.error = `Invalid urlPattern regex: ${pb.urlPattern}`;
    }

    const registry = allRegistries[pb.selectors];
    result.registryFound = !!registry;
    if (registry) {
      result.registryKeys = Object.keys(registry).filter(k => k !== 'version');
      result.registryVersion = registry.version;
    }

    // 2. Pick a URL to navigate to
    const url = chooseUrlFor(pb.urlPattern);
    result.testUrl = url;
    if (!url) {
      result.skipped = 'no test URL chosen for this urlPattern';
      results.push(result);
      console.log(`  → skipped: ${result.skipped}`);
      continue;
    }

    // 3. Skip writes (anything with auto trustLevel that DOES writes — accept/deny/connect/etc.)
    const isAuto = (pb.trustLevel || 'auto') === 'auto';
    const writesWithoutPrompt = isAuto && /click|typeText|handleInviteModal|navigateNext/.test(JSON.stringify(pb.steps || []));
    if (writesWithoutPrompt) {
      // We'll navigate + inject but NOT trigger runPlaybook
      result.skipped = 'has write actions; not triggering run; only inspecting selectors';
    }

    try {
      // 4. Navigate
      const loaded = new Promise(r => client.once('Page.loadEventFired', r));
      await Page.navigate({ url });
      await Promise.race([loaded, new Promise(r => setTimeout(r, 15000))]);
      await new Promise(r => setTimeout(r, 2000));  // settle

      // Re-set the binding name on the new page (page may be a new document)
      const prelude = `window.__fusenlink_cdpSendName = ${JSON.stringify(bindingName)};`;
      await Runtime.evaluate({ expression: prelude });

      // 5. Inject bridge + side chunks + content bundle
      await Runtime.evaluate({ expression: bridge });
      for (const chunk of sideChunks) {
        const chunkSrc = await fs.readFile(path.join(distDir, chunk), 'utf8');
        await Runtime.evaluate({ expression: wrapBundle(chunkSrc) });
      }
      await Runtime.evaluate({ expression: wrapBundle(bundleSrc) });

      // 6. Wait briefly, then probe DOM for what selectors found
      await new Promise(r => setTimeout(r, 2500));

      const probeScript = `(function() {
        const reg = ${JSON.stringify(registry || {})};
        const out = { keys: {} };
        if (!reg) return JSON.stringify({error: 'no registry'});
        for (const [key, entry] of Object.entries(reg)) {
          if (key === 'version' || !entry || typeof entry !== 'object' || !Array.isArray(entry.strategies)) continue;
          let found = 0;
          let firstSelector = '';
          for (const strat of entry.strategies) {
            if (strat.type !== 'css') continue; // only test CSS for simplicity in this probe
            try {
              const els = document.querySelectorAll(strat.value);
              if (els.length > 0) {
                found = els.length;
                firstSelector = strat.value;
                break;
              }
            } catch (e) { /* bad selector */ }
          }
          out.keys[key] = { found, firstSelector };
        }
        out.injectedButtons = !!document.querySelector('[data-playbook-injected]');
        out.actionContainer = !!document.querySelector('.li-bulk-action-buttons');
        out.url = location.href;
        return JSON.stringify(out);
      })()`;

      const probeResult = await Runtime.evaluate({ expression: probeScript, returnByValue: true });
      result.probe = JSON.parse(probeResult.result.value || '{}');

      // 7. Screenshot
      const shotPath = path.join(REPORT_DIR, `${id}.png`);
      const shot = await Page.captureScreenshot({ format: 'png' });
      await fs.writeFile(shotPath, Buffer.from(shot.data, 'base64'));
      result.screenshot = shotPath;

      // Summary
      const probeKeys = Object.keys(result.probe.keys || {});
      const matchedKeys = probeKeys.filter(k => result.probe.keys[k].found > 0);
      console.log(`  → ${matchedKeys.length}/${probeKeys.length} selector keys found elements; buttons injected: ${result.probe.injectedButtons}`);
    } catch (err) {
      result.error = err.message;
      console.log(`  → ERROR: ${err.message}`);
    }

    results.push(result);
  }

  // Write final report
  const reportPath = path.join(REPORT_DIR, 'report.json');
  await fs.writeFile(reportPath, JSON.stringify(results, null, 2));

  // Markdown summary
  const md = ['# Playbook test report', '', `Tested ${results.length} playbooks. Report dir: \`${REPORT_DIR}\``, ''];
  md.push('| Playbook | Trust | URL pattern | Registry | Keys matched | Notes |');
  md.push('|---|---|---|---|---|---|');
  for (const r of results) {
    const probeKeys = Object.keys(r.probe?.keys || {});
    const matched = probeKeys.filter(k => r.probe.keys[k].found > 0).length;
    const notes = [];
    if (r.error) notes.push(`error: ${r.error}`);
    if (r.skipped) notes.push(r.skipped);
    if (!r.registryFound) notes.push('registry MISSING');
    if (matched === 0 && probeKeys.length > 0 && !r.error) notes.push('NO selectors matched');
    md.push(`| ${r.id} | ${r.trustLevel} | \`${r.urlPattern}\` | ${r.selectorsKey} | ${matched}/${probeKeys.length} | ${notes.join('; ') || 'OK'} |`);
  }
  await fs.writeFile(path.join(REPORT_DIR, 'report.md'), md.join('\n'));

  console.log(`\n[test] DONE. Report:`);
  console.log(`  ${reportPath}`);
  console.log(`  ${path.join(REPORT_DIR, 'report.md')}`);

  await client.close();
  process.exit(0);
}

main().catch(err => {
  console.error('[test] fatal:', err);
  process.exit(1);
});
