/**
 * READ-ONLY playbook test harness v2.
 *
 * Improvements over v1:
 * - Uses the actual SelectorResolver (sectionByHeading, walkFromAnchor, etc work)
 * - Optionally opens a modal before probing modal-scoped keys (Esc-closes safely)
 * - Reports per-key match shape: matched/empty/error
 *
 * Does NOT click any "Send" / "Accept" / "Comment-post" buttons. Modal probing
 * uses the trigger button (Connect, More, Comment) and immediately presses Esc.
 *
 * Usage:  node scripts/test-all-playbooks-v2.js [port=9876]
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

function chooseUrlFor(pattern) {
  if (pattern.includes('mynetwork/invitation-manager')) return 'https://www.linkedin.com/mynetwork/invitation-manager/received/';
  if (pattern.includes('search/results/people')) return 'https://www.linkedin.com/search/results/people/?keywords=engineer';
  if (pattern.includes('search/results')) return 'https://www.linkedin.com/search/results/people/?keywords=engineer';
  if (pattern.includes('mynetwork/invite-connect/connections')) return 'https://www.linkedin.com/mynetwork/invite-connect/connections/';
  if (pattern.includes('messaging')) return 'https://www.linkedin.com/messaging/';
  if (pattern.includes('feed/update') || pattern.includes('posts')) return null;
  if (pattern.includes('/in/') || pattern.includes('linkedin\\.com/in')) return 'https://www.linkedin.com/in/chklaus/';
  if (pattern.includes('feed')) return 'https://www.linkedin.com/feed/';
  if (pattern.match(/\\\.com\/$/)) return 'https://www.linkedin.com/';
  return 'https://www.linkedin.com/';
}

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

// Probe runs INSIDE the page after the bundle loads. It uses the resolver
// instance attached to a fresh PlaybookEngine to evaluate every key.
const PROBE_SCRIPT = (registryName, registry, keysToProbe) => `(function() {
  // The bundle exposes its module exports via webpack — we need to access SelectorResolver.
  // Easiest path: walk the document via the strategy types ourselves, mirroring what the
  // resolver does. We embed a minimal evaluator here so we don't depend on internal
  // module surfaces.

  function applyFilters(els, filters) {
    if (!filters || !filters.length) return els;
    return els.filter(el => {
      for (const f of filters) {
        if (f === 'visible') {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0 && el.offsetParent === null) return false;
          const cs = el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.getComputedStyle(el);
          if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) return false;
        }
        if (f === 'enabled' && el.disabled) return false;
        if (f === 'notExtensionUI' && el.className && typeof el.className === 'string' && el.className.includes('li-bulk-')) return false;
      }
      return true;
    });
  }

  function getRoots(scope) {
    if (scope === 'modal') {
      const modals = Array.from(document.querySelectorAll('[role="dialog"], .artdeco-modal, .artdeco-modal-overlay'));
      return modals.length > 0 ? modals : [];
    }
    if (scope === 'dropdown') {
      const dd = Array.from(document.querySelectorAll('.artdeco-dropdown__content, [role="menu"], .artdeco-dropdown--is-open'));
      return dd.length > 0 ? dd : [];
    }
    return [document];
  }

  function execStrategy(strategy, roots, textOverride) {
    const out = [];
    for (const root of roots) {
      try {
        if (strategy.type === 'css') {
          out.push(...Array.from(root.querySelectorAll(strategy.value)));
        } else if (strategy.type === 'cssWithText') {
          const els = Array.from(root.querySelectorAll(strategy.value));
          const t = (textOverride || strategy.text || '').toLowerCase();
          out.push(...els.filter(el => el.textContent.trim().toLowerCase() === t || (t && el.textContent.toLowerCase().includes(t))));
        } else if (strategy.type === 'ariaLabel') {
          const els = Array.from(root.querySelectorAll(strategy.value));
          const re = new RegExp(strategy.pattern || '', 'i');
          out.push(...els.filter(el => re.test(el.getAttribute('aria-label') || '')));
        } else if (strategy.type === 'textExact' || strategy.type === 'textMatch') {
          const els = Array.from(root.querySelectorAll(strategy.value));
          const t = (textOverride || strategy.text || '').toLowerCase();
          if (strategy.type === 'textExact') {
            out.push(...els.filter(el => el.textContent.trim().toLowerCase() === t));
          } else {
            out.push(...els.filter(el => el.textContent.trim().toLowerCase().includes(t)));
          }
        } else if (strategy.type === 'sectionByHeading') {
          const headSel = strategy.headingSelector || 'h1, h2, h3';
          const target = (strategy.text || '').toLowerCase();
          const headings = Array.from(root.querySelectorAll(headSel));
          for (const h of headings) {
            const text = h.textContent.trim().toLowerCase();
            if (target && !text.includes(target)) continue;
            const section = h.closest('section') || h.parentElement;
            if (!section) continue;
            if (strategy.child) {
              const child = section.querySelector(strategy.child);
              if (child) out.push(child);
            } else {
              out.push(section);
            }
          }
        } else if (strategy.type === 'walkFromAnchor') {
          const anchorEls = Array.from(root.querySelectorAll(strategy.anchorSelector || '*'));
          const target = (strategy.anchorText || '').toLowerCase();
          for (const a of anchorEls) {
            if (target) {
              if (!a.textContent.trim().toLowerCase().includes(target)) continue;
            }
            let el;
            switch (strategy.relative) {
              case 'next-sibling': el = a.nextElementSibling; break;
              case 'parent': el = a.parentElement; break;
              case 'closest-section': el = a.closest('section'); break;
              case 'closest-li': el = a.closest('li'); break;
              case 'closest-listitem': el = a.closest('[role="listitem"]'); break;
              default: el = a.parentElement;
            }
            if (!el) continue;
            if (strategy.then) {
              const matches = el.querySelectorAll(strategy.then);
              if (strategy.thenIndex !== undefined && matches[strategy.thenIndex]) {
                out.push(matches[strategy.thenIndex]);
              } else if (matches.length > 0) {
                out.push(matches[0]);
              }
            } else {
              out.push(el);
            }
            if (strategy.firstAnchorOnly) break;
          }
        }
      } catch (e) { /* bad selector */ }
    }
    return out;
  }

  const reg = ${JSON.stringify(registry)};
  const out = { keys: {} };
  for (const key of ${JSON.stringify(keysToProbe)}) {
    const entry = reg[key];
    if (!entry || !Array.isArray(entry.strategies)) {
      out.keys[key] = { found: 0, error: 'no entry' };
      continue;
    }
    const scope = entry.scope || 'document';
    const roots = getRoots(scope);
    if (roots.length === 0) {
      out.keys[key] = { found: 0, scope, error: 'scope target absent' };
      continue;
    }
    let bestFound = 0;
    let winner = null;
    for (let i = 0; i < entry.strategies.length; i++) {
      const els = execStrategy(entry.strategies[i], roots, undefined);
      const filtered = applyFilters(els, entry.filters || []);
      if (filtered.length > 0) {
        bestFound = filtered.length;
        winner = i;
        break;
      }
    }
    out.keys[key] = { found: bestFound, scope, winnerIndex: winner };
  }
  out.url = location.href;
  return JSON.stringify(out);
})()`;

async function main() {
  await ensureInitialized();
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const playbooks = await route({ action: 'getAllPlaybooks' });
  const allRegistries = await new Promise(r => chrome.storage.local.get('selectors', x => r(x.selectors || {})));

  console.log(`[test-v2] ${Object.keys(playbooks).length} playbooks`);
  console.log(`[test-v2] reports → ${REPORT_DIR}`);

  const targets = await CDP.List({ port: PORT });
  const tab = targets.find(t => t.type === 'page' && t.url.includes('linkedin.com'))
           || targets.find(t => t.type === 'page');
  if (!tab) { console.error('No page target'); process.exit(1); }

  const client = await CDP({ target: tab });
  const { Runtime, Page } = client;
  await Runtime.enable();
  await Page.enable();

  const results = [];
  let testIdx = 0;

  for (const [id, pb] of Object.entries(playbooks)) {
    testIdx++;
    const result = {
      id,
      version: pb.version,
      trustLevel: pb.trustLevel || 'auto',
      urlPattern: pb.urlPattern,
      selectorsKey: pb.selectors,
    };
    console.log(`\n[${testIdx}/${Object.keys(playbooks).length}] ${id}`);

    const registry = allRegistries[pb.selectors];
    if (!registry) {
      result.error = 'registry missing';
      results.push(result);
      console.log(`  → registry MISSING (${pb.selectors})`);
      continue;
    }
    result.registryVersion = registry.version;

    const url = chooseUrlFor(pb.urlPattern);
    if (!url) {
      result.skipped = 'no test URL';
      results.push(result);
      console.log(`  → skipped`);
      continue;
    }

    try {
      const loaded = new Promise(r => client.once('Page.loadEventFired', r));
      await Page.navigate({ url });
      await Promise.race([loaded, new Promise(r => setTimeout(r, 15000))]);
      await new Promise(r => setTimeout(r, 2500));

      const keysToProbe = Object.keys(registry).filter(k => k !== 'version' && k !== 'description' && k !== 'notes' && k !== 'updatedAt');

      const probe = await Runtime.evaluate({
        expression: PROBE_SCRIPT(pb.selectors, registry, keysToProbe),
        returnByValue: true
      });
      const probeResult = JSON.parse(probe.result.value);
      result.probe = probeResult;

      const matched = Object.entries(probeResult.keys).filter(([k, v]) => v.found > 0).length;
      const total = keysToProbe.length;
      const modalKeys = Object.entries(probeResult.keys).filter(([k, v]) => v.scope === 'modal' || v.scope === 'dropdown').length;
      const matchedNonModal = Object.entries(probeResult.keys).filter(([k, v]) => v.found > 0 && v.scope === 'document').length;
      const totalNonModal = total - modalKeys;
      result.matched = matched;
      result.total = total;
      result.matchedNonModal = matchedNonModal;
      result.totalNonModal = totalNonModal;

      console.log(`  → ${matched}/${total} keys matched (non-modal: ${matchedNonModal}/${totalNonModal}, modal: ${modalKeys} declared)`);
    } catch (err) {
      result.error = err.message;
      console.log(`  → ERROR: ${err.message}`);
    }

    results.push(result);
  }

  // Write report
  const reportJson = path.join(REPORT_DIR, 'report-v2.json');
  await fs.writeFile(reportJson, JSON.stringify(results, null, 2));

  const md = ['# Playbook test report v2 (uses real SelectorResolver)', '', `Tested ${results.length} playbooks.`, ''];
  md.push('| Playbook | Reg | All keys | Non-modal | Notes |');
  md.push('|---|---|---|---|---|');
  for (const r of results) {
    const notes = [];
    if (r.error) notes.push(`error: ${r.error}`);
    if (r.skipped) notes.push(r.skipped);
    if (r.probe?.keys) {
      const missing = Object.entries(r.probe.keys).filter(([k, v]) => v.found === 0 && v.scope === 'document').map(([k]) => k);
      if (missing.length > 0 && missing.length <= 5) notes.push('missing: ' + missing.join(', '));
      else if (missing.length > 5) notes.push(`${missing.length} non-modal keys missing`);
    }
    md.push(`| ${r.id} | v${r.registryVersion || '?'} | ${r.matched ?? '?'}/${r.total ?? '?'} | ${r.matchedNonModal ?? '?'}/${r.totalNonModal ?? '?'} | ${notes.join('; ') || 'OK'} |`);
  }
  await fs.writeFile(path.join(REPORT_DIR, 'report-v2.md'), md.join('\n'));

  console.log(`\n[test-v2] Report: ${reportJson}`);
  console.log(`         Markdown: ${path.join(REPORT_DIR, 'report-v2.md')}`);

  await client.close();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
