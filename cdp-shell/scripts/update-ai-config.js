/**
 * Patch the persisted AI config (~/.fusenlink/state.json) without going
 * through the options page. Useful when iterating on baseUrl / model /
 * prependSystem / prependUser against a CDP-shell session.
 *
 * Usage:
 *   node update-ai-config.js '<json patch>'
 *   node update-ai-config.js '{"prependUser":"/no_think","prependSystem":""}'
 *
 * Note: does not call aiStatus (which would hit the configured baseUrl and
 * block if it's unreachable). Reads/writes the JSON store directly.
 */

import '../lib/node-chrome-stub.js';
import { storageApi } from '../lib/storage.js';
import { STORAGE_KEYS, DEFAULT_AI_CONFIG } from '../../src/shared/constants.js';

async function main() {
  const patch = JSON.parse(process.argv[2] || '{}');

  const current = await new Promise((r) =>
    storageApi.local.get([STORAGE_KEYS.AI_CONFIG], r)
  );
  const before = current[STORAGE_KEYS.AI_CONFIG] || { ...DEFAULT_AI_CONFIG };
  console.log('Before:', JSON.stringify({ ...before, apiKey: before.apiKey ? '<redacted>' : '' }, null, 2));

  const merged = { ...before, ...patch };
  await new Promise((r) =>
    storageApi.local.set({ [STORAGE_KEYS.AI_CONFIG]: merged }, r)
  );
  console.log('After: ', JSON.stringify({ ...merged, apiKey: merged.apiKey ? '<redacted>' : '' }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
