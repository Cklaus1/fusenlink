#!/usr/bin/env node
/**
 * FusenLink CLI — control the Chrome extension from the terminal.
 *
 * Usage:
 *   fusenlink run <playbook>         Run a playbook
 *   fusenlink stop                   Stop the current playbook
 *   fusenlink status                 Check extension status
 *   fusenlink playbooks              List available playbooks
 *   fusenlink schedule list          List schedules
 *   fusenlink schedule set <id> <m>  Set schedule (interval in minutes)
 *   fusenlink data <collection>      Get stored data
 *   fusenlink ai status              Check AI provider status
 *   fusenlink ai configure           Configure AI provider
 *   fusenlink health                 Check sidecar + extension health
 */

const client = require('../lib/client');

const [,, command, ...args] = process.argv;

async function main() {
  try {
    switch (command) {
      case 'run': {
        const playbookId = args[0];
        if (!playbookId) {
          console.error('Usage: fusenlink run <playbook-id>');
          process.exit(1);
        }
        console.log(`Running playbook: ${playbookId}`);
        const result = await client.post('/api/run', { playbookId });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'stop': {
        const result = await client.post('/api/stop', {});
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'status': {
        const result = await client.get('/api/status');
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'playbooks': {
        const result = await client.get('/api/playbooks');
        if (result && typeof result === 'object' && !result.error) {
          console.log('\nAvailable Playbooks:');
          for (const [id, pb] of Object.entries(result)) {
            const ai = pb.settings?.requiresAI ? ' [AI]' : '';
            const trust = pb.trustLevel ? ` (${pb.trustLevel})` : '';
            console.log(`  ${id}${ai}${trust}`);
            console.log(`    ${pb.description || pb.name}`);
          }
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
        break;
      }

      case 'schedule': {
        const subCmd = args[0];
        if (subCmd === 'list' || !subCmd) {
          const result = await client.get('/api/schedules');
          console.log(JSON.stringify(result, null, 2));
        } else if (subCmd === 'set') {
          const playbookId = args[1];
          const intervalRaw = args[2];
          if (!playbookId || !intervalRaw || !/^\d+$/.test(intervalRaw)) {
            console.error('Usage: fusenlink schedule set <playbook-id> <interval-minutes-as-integer>');
            console.error('  e.g.: fusenlink schedule set accept-invites 60');
            process.exit(1);
          }
          const interval = parseInt(intervalRaw, 10);
          if (interval < 1 || interval > 10080) {
            console.error('Interval must be between 1 and 10080 minutes (1 week).');
            process.exit(1);
          }
          const result = await client.post('/api/schedule', {
            playbookId,
            config: { enabled: true, intervalMinutes: interval }
          });
          console.log(`Scheduled ${playbookId} every ${interval} minutes`);
          console.log(JSON.stringify(result, null, 2));
        } else if (subCmd === 'disable') {
          const playbookId = args[1];
          const result = await client.post('/api/schedule', {
            playbookId,
            config: { enabled: false, intervalMinutes: 0 }
          });
          console.log(JSON.stringify(result, null, 2));
        }
        break;
      }

      case 'data': {
        const collection = args[0];
        if (!collection) {
          console.error('Usage: fusenlink data <collection> [--full] [--format csv]');
          console.error('Collections: contacts, inbox, outreach, profileReviews, activityLog');
          console.error('  --full    Dump all records (may be large)');
          process.exit(1);
        }
        const isFull = args.includes('--full');
        const formatIdx = args.indexOf('--format');
        const format = formatIdx >= 0 ? args[formatIdx + 1] : 'json';
        const limit = isFull ? 0 : 10;

        let apiPath = `/api/data/${collection}?format=${format}&limit=${limit}`;
        const result = await client.get(apiPath);

        if (!isFull) {
          const itemCount = result?.items ? Object.keys(result.items).length : (result?.entries?.length || 0);
          console.log(`Showing first ${Math.min(limit, itemCount)} of ${itemCount} items. Use --full for complete data.`);
        }
        if (format === 'csv' && result?.csv) {
          process.stdout.write(result.csv);
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
        break;
      }

      case 'ai': {
        const subCmd = args[0];
        if (subCmd === 'status') {
          const result = await client.get('/api/ai/status');
          console.log(JSON.stringify(result, null, 2));
        } else if (subCmd === 'configure') {
          const config = {};
          for (let i = 1; i < args.length; i += 2) {
            const key = args[i].replace('--', '');
            config[key] = args[i + 1];
          }
          if (Object.keys(config).length === 0) {
            console.error('Usage: fusenlink ai configure --provider ollama --baseUrl http://localhost:11434/v1 --model llama3.1:8b');
            process.exit(1);
          }
          const result = await client.post('/api/ai/configure', config);
          console.log(JSON.stringify(result, null, 2));
        } else if (subCmd === 'chat') {
          const prompt = args.slice(1).join(' ');
          const result = await client.post('/api/ai/chat', {
            aiType: 'extract_summary',
            input: prompt
          });
          console.log(result.content || JSON.stringify(result, null, 2));
        } else {
          console.error('Usage: fusenlink ai <status|configure|chat>');
        }
        break;
      }

      case 'sequence':
      case 'seq': {
        const subCmd = args[0];
        if (subCmd === 'list' || !subCmd) {
          const result = await client.get('/api/sequences');
          const items = result?.items || {};
          if (Object.keys(items).length === 0) {
            console.log('No sequences. Create one with: fusenlink seq create "My Campaign"');
          } else {
            console.log('\nSequences:');
            for (const [id, seq] of Object.entries(items)) {
              const s = seq.stats || {};
              console.log(`  ${seq.name} [${seq.status}]`);
              console.log(`    ${s.enrolled || 0} enrolled, ${s.sent || 0} sent, ${s.replied || 0} replied, ${s.completed || 0} completed`);
              console.log(`    ID: ${id}`);
            }
          }
        } else if (subCmd === 'create') {
          const name = args[1] || 'Outreach Campaign';
          const goal = args.includes('--goal') ? args[args.indexOf('--goal') + 1] : '';
          const result = await client.post('/api/sequence/create', {
            name,
            goal,
            steps: [
              { delayDays: 0, template: 'Hi {name}, I came across your profile and was impressed by your work. I\'d love to connect and explore potential synergies.', aiType: 'personalize' },
              { delayDays: 3, template: 'Hi {name}, just following up on my previous message. Would love to hear your thoughts.', aiType: 'followup' },
              { delayDays: 7, template: 'Hi {name}, last note from me. If now isn\'t the right time, no worries at all. The door is always open.', aiType: 'final' }
            ]
          });
          console.log(`Created sequence: ${result.name} (${result.id})`);
          console.log(`  ${result.steps.length} steps. Enroll contacts with: fusenlink seq enroll ${result.id}`);
        } else if (subCmd === 'enroll') {
          const seqId = args[1];
          if (!seqId) { console.error('Usage: fusenlink seq enroll <sequenceId>'); process.exit(1); }
          // Enroll from stored contacts
          const contacts = await client.get('/api/data/contacts');
          const items = contacts?.items ? Object.values(contacts.items) : [];
          if (items.length === 0) { console.log('No contacts. Run "fusenlink run search-extract" first.'); break; }
          const result = await client.post('/api/sequence/enroll', { sequenceId: seqId, contacts: items });
          console.log(`Enrolled ${result.enrolled} contacts into sequence`);
        } else if (subCmd === 'delete') {
          const seqId = args[1];
          await client.post('/api/sequence/delete', { sequenceId: seqId });
          console.log('Sequence deleted');
        } else {
          console.error('Usage: fusenlink seq <list|create|enroll|delete>');
        }
        break;
      }

      case 'health': {
        const result = await client.get('/api/health');
        console.log(`Sidecar: running`);
        console.log(`Extension: ${result.extensionConnected ? 'connected' : 'not connected'}`);
        break;
      }

      default:
        console.log(`FusenLink CLI v1.0.0

Usage: fusenlink <command> [options]

Commands:
  run <playbook>              Run a playbook
  stop                        Stop current playbook
  status                      Check extension status
  playbooks                   List available playbooks
  schedule list               List schedules
  schedule set <id> <minutes> Set recurring schedule
  schedule disable <id>       Disable a schedule
  data <collection>           Get stored data (contacts, inbox, etc.)
  ai status                   Check AI provider status
  ai configure --provider ... Configure AI provider
  ai chat <prompt>            Chat with AI
  health                      Check sidecar + extension connection

Options:
  --format csv|json           Output format for data command
  --limit N                   Limit results`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
