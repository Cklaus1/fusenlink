#!/usr/bin/env node
/**
 * FusenLink CDP shell — drive a running Chrome from the terminal.
 *
 * Prerequisite:
 *   google-chrome --remote-debugging-port=9222
 *   (log into LinkedIn manually, leave the tab open)
 *
 * Usage:
 *   fusenlink-cdp list                  # list available playbooks
 *   fusenlink-cdp run <playbook-id>     # run a playbook on the open LinkedIn tab
 *   fusenlink-cdp stop                  # stop the running playbook
 *   fusenlink-cdp status                # report engine status
 *   fusenlink-cdp ai status             # check AI provider configuration
 */

import { connect } from '../lib/shell.js';
import { route, ensureInitialized } from '../lib/router.js';

const [, , command, ...args] = process.argv;

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') { flags.host = argv[++i]; continue; }
    if (a === '--port') { flags.port = parseInt(argv[++i], 10); continue; }
    if (a === '--url') { flags.urlMatch = argv[++i]; continue; }
    if (a === '--persist') { flags.persist = true; continue; }
    positional.push(a);
  }
  return { flags, positional };
}

async function cmdList() {
  await ensureInitialized();
  const playbooks = await route({ action: 'getAllPlaybooks' });
  if (!playbooks || typeof playbooks !== 'object') {
    console.error('Failed to load playbooks');
    process.exit(1);
  }
  console.log('\nAvailable playbooks:');
  for (const [id, pb] of Object.entries(playbooks)) {
    const ai = pb.settings?.requiresAI ? ' [AI]' : '';
    const trust = pb.trustLevel ? ` (${pb.trustLevel})` : '';
    console.log(`  ${id}${ai}${trust}`);
    if (pb.description) console.log(`    ${pb.description}`);
  }
}

async function cmdRun(playbookId, flags) {
  if (!playbookId) {
    console.error('Usage: fusenlink-cdp run <playbook-id> [--port 9222] [--url linkedin.com/...]');
    process.exit(1);
  }

  console.log(`[cdp] connecting on port ${flags.port || 9222}...`);
  const session = await connect(flags);

  try {
    console.log(`[cdp] running playbook: ${playbookId}`);
    const result = await session.run(playbookId);
    console.log('[cdp] result:', JSON.stringify(result, null, 2));
  } finally {
    await session.close();
  }
}

async function cmdStop(flags) {
  const session = await connect(flags);
  try {
    const result = await session.stop();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await session.close();
  }
}

async function cmdStatus(flags) {
  console.log(`[cdp] connecting on port ${flags.port || 9222} (host=${flags.host || 'localhost'})...`);
  const session = await connect(flags);
  try {
    const result = await session.status();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await session.close();
  }
}

async function cmdAttach(flags) {
  console.log(`[cdp] attaching on ${flags.host || 'localhost'}:${flags.port || 9222} (persist=${!!flags.persist})...`);
  const session = await connect({ ...flags, persist: true });
  console.log(`[cdp] bridge active. The in-page "Accept All" button (and any other`);
  console.log(`      injected button) will work while this process is running.`);
  console.log(`[cdp] Ctrl+C to detach.`);

  // Keep the process alive until SIGINT/SIGTERM. The CDP client + binding
  // listeners are already wired; nothing else to do.
  await new Promise((resolve) => {
    process.on('SIGINT', () => { console.log('\n[cdp] detaching...'); resolve(); });
    process.on('SIGTERM', () => resolve());
  });
  await session.close();
}

async function cmdAi(sub) {
  await ensureInitialized();
  if (sub === 'status') {
    const status = await route({ action: 'aiStatus' });
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.error('Usage: fusenlink-cdp ai status');
  process.exit(1);
}

async function main() {
  const { flags, positional } = parseFlags(args);

  switch (command) {
    case 'list':
      await cmdList();
      break;
    case 'run':
      await cmdRun(positional[0], flags);
      break;
    case 'stop':
      await cmdStop(flags);
      break;
    case 'status':
      await cmdStatus(flags);
      break;
    case 'attach':
      await cmdAttach(flags);
      break;
    case 'ai':
      await cmdAi(positional[0]);
      break;
    case '--help':
    case '-h':
    case undefined:
      console.log(`fusenlink-cdp — drive Chrome from the CLI

Prerequisite:
  google-chrome --remote-debugging-port=9222
  (log into LinkedIn manually, leave the tab open)

Commands:
  list                      list available playbooks
  run <playbook-id>         run a playbook on the LinkedIn tab (one-shot)
  attach                    inject the engine, persist across reloads, keep
                            the bridge alive so the in-page "Accept All" /
                            other injected buttons work. Ctrl+C to detach.
  stop                      stop the running playbook
  status                    report engine status
  ai status                 check AI provider configuration

Options:
  --host <hostname>         CDP host (default localhost — use this to reach
                            Windows Chrome from WSL when localhostForwarding is on)
  --port <n>                CDP port (default 9222)
  --url <substring>         override target URL match
`);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run with --help for usage');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('[cdp] error:', err.message);
  process.exit(1);
});
