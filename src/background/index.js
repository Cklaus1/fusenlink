/**
 * Background Service Worker — entry point.
 * Manages settings, playbook storage, scheduling, and message routing.
 */

import { initializeDefaults } from './playbook-store.js';
import { initMessageRouter, handleMessage } from './message-router.js';
import { initScheduler } from './scheduler.js';
import { initUpdater } from './updater.js';
import { initWsBridge } from './ws-bridge.js';
import { initSequenceManager } from './sequence-manager.js';
import { initReplyDetector } from './reply-detector.js';
import { initCohortManager } from './cohort-manager.js';

// Initialize defaults on install
chrome.runtime.onInstalled.addListener(async () => {
  await initializeDefaults();
});

// Bug 16: also re-run on browser/service-worker startup. onInstalled does
// NOT fire when the user toggles the extension off and back on, so any
// migration that should have run during that cycle was being skipped.
// initializeDefaults is idempotent (only seeds when keys are missing or
// when the shipped version is higher than what's stored), so re-running
// here is safe.
chrome.runtime.onStartup.addListener(async () => {
  await initializeDefaults();
  // Scheduler restores alarms on init
});

// Initialize the message router
initMessageRouter();

// Initialize the scheduler (restores saved alarms)
initScheduler();

// Initialize the updater (optional — set a URL to enable remote updates)
// URL must be HTTPS and hostname must be in the allowedHosts list (second arg,
// default: ['raw.githubusercontent.com']). See updater.js SECURITY / TODO notes
// before re-enabling — signature verification is not yet implemented.
// initUpdater('https://raw.githubusercontent.com/Cklaus1/fusenlink/main/playbooks/latest.json');
// initUpdater('https://raw.githubusercontent.com/Cklaus1/fusenlink/main/playbooks/latest.json', ['raw.githubusercontent.com']);

// Initialize the sequence manager (hourly check for due messages)
initSequenceManager();

// Initialize reply detector (checks inbox every 6 hours for sequence replies)
initReplyDetector();

// Initialize cohort manager (syncs shared accelerator data hourly)
initCohortManager();

// Initialize WebSocket bridge to sidecar (for CLI access)
initWsBridge((message, respond) => {
  // Route WS messages through the same handler as chrome.runtime messages
  handleMessage(message, null, respond);
});
