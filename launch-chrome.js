/**
 * FusenLink one-command bring-up.
 *
 *   node launch-chrome.js                 Start the sidecar + launch Linux
 *                                         Chromium with the extension loaded,
 *                                         navigated to the invitation manager.
 *
 *   node launch-chrome.js --sidecar-only  Start the sidecar only and print the
 *                                         auth token. Use this when you want to
 *                                         drive LinkedIn from your own Windows
 *                                         Chrome (see the Windows note in README)
 *                                         instead of the bundled Chromium.
 *
 * Either way the auth token is printed prominently so you can
 *   export FUSENLINK_TOKEN=<token>
 * in the shell where you run the `fusenlink` CLI.
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const SIDECAR = path.join(ROOT, 'sidecar', 'server.js');
const TOKEN_FILE = path.join(os.homedir(), '.fusenlink', 'sidecar.token');

const args = process.argv.slice(2);
const sidecarOnly = args.includes('--sidecar-only') || args.includes('--no-chrome');

// Resolve a stable token: prefer an explicit env var, then the persisted token
// file (so we reuse what the sidecar already saved), else generate a fresh one.
// We pass it to the sidecar via FUSENLINK_TOKEN so the value is deterministic
// and we can print it — the sidecar itself does not echo a reused token.
function resolveToken() {
  if (process.env.FUSENLINK_TOKEN) return process.env.FUSENLINK_TOKEN;
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t) return t;
  } catch { /* no token file yet */ }
  return crypto.randomBytes(32).toString('hex');
}

const TOKEN = resolveToken();

// --- Start the sidecar as a child process ---
const sidecar = spawn(process.execPath, [SIDECAR], {
  cwd: path.join(ROOT, 'sidecar'),
  env: { ...process.env, FUSENLINK_TOKEN: TOKEN },
  stdio: ['ignore', 'inherit', 'inherit'],
});

sidecar.on('error', (err) => {
  console.error(`[launch] failed to start sidecar: ${err.message}`);
  process.exit(1);
});
sidecar.on('exit', (code, signal) => {
  console.log(`[launch] sidecar exited (code=${code} signal=${signal || 'none'})`);
  process.exit(code || 0);
});

function banner() {
  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log('  FusenLink sidecar is starting on http://localhost:9333');
  console.log('');
  console.log('  AUTH TOKEN:');
  console.log(`    ${TOKEN}`);
  console.log('');
  console.log('  In the shell where you run the CLI:');
  console.log(`    export FUSENLINK_TOKEN=${TOKEN}`);
  console.log('    node cli/bin/fusenlink.js health');
  console.log(`${line}\n`);
}

// Clean up the sidecar when we exit.
function shutdown() {
  try { sidecar.kill('SIGTERM'); } catch { /* already gone */ }
}
process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });

async function main() {
  banner();

  if (sidecarOnly) {
    console.log('[launch] --sidecar-only: not launching Chromium.');
    console.log('[launch] Load/refresh the extension in your own Chrome and open a');
    console.log('[launch] linkedin.com tab. Watch for "[sidecar] Extension connected".');
    console.log('[launch] Ctrl-C to stop the sidecar.\n');
    // Keep this launcher alive alongside the sidecar child.
    setInterval(() => {}, 1 << 30);
    return;
  }

  // Lazy-require Playwright so --sidecar-only works without browsers installed.
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (err) {
    console.error('[launch] Playwright not available; use --sidecar-only and');
    console.error(`[launch] your own Chrome instead. (${err.message})`);
    return;
  }

  const context = await chromium.launchPersistentContext('/tmp/chrome-profile', {
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      '--no-sandbox',
      '--remote-debugging-port=9222',
    ],
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.linkedin.com/mynetwork/invitation-manager/');

  console.log('[launch] Chromium open. Log into LinkedIn in this window if needed.');
  console.log('[launch] The profile at /tmp/chrome-profile persists across runs.');
  console.log('[launch] Window stays open until you close it or Ctrl-C.\n');

  context.on('close', () => { shutdown(); process.exit(0); });
}

main().catch((e) => {
  console.error('[launch] error:', e);
  shutdown();
  process.exit(1);
});
