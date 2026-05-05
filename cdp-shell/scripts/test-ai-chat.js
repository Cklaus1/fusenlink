/**
 * Smoke-test the AI path end-to-end via the same message router that the
 * content-script playbook engine uses. Reads the persisted AI config from
 * ~/.fusenlink/state.json — no Chrome required.
 *
 * Usage: node test-ai-chat.js [aiType]
 *   node test-ai-chat.js classify_inbox
 */

import '../lib/node-chrome-stub.js';
import * as AI from '../../src/background/ai-client.js';
import { route, ensureInitialized } from '../lib/router.js';

const aiType = process.argv[2] || 'classify_inbox';

const SAMPLE_INPUTS = {
  classify_inbox: {
    threads: [
      { id: 't1', preview: 'Hi, quick question — are you the right person to talk to about your CRM stack?' },
      { id: 't2', preview: 'Loved your post on agentic workflows. Open to a 20-min chat?' },
      { id: 't3', preview: 'Opening for a Staff ML Engineer — interested?' },
      { id: 't4', preview: 'Hey! Coming through SF in June, want to grab coffee?' }
    ]
  },
  hello: 'Reply with the JSON {"hello":"world"} and nothing else.'
};

async function main() {
  await ensureInitialized();
  const t0 = Date.now();
  const result = await route({
    action: 'aiRequest',
    aiType,
    input: SAMPLE_INPUTS[aiType] ?? aiType
  });
  const dt = Date.now() - t0;
  console.log(`[${dt}ms]`);
  console.log(JSON.stringify(result, null, 2).slice(0, 2000));
}

main().catch((err) => { console.error('error:', err.message); process.exit(1); });
