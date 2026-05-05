/**
 * Shared constants — single source of truth for defaults, storage keys, and config.
 */

export const DEFAULT_SETTINGS = {
  maxInvites: 50,
  delayMs: 1500
};

export const STORAGE_KEYS = {
  PLAYBOOKS: 'playbooks',
  SELECTORS: 'selectors',
  SCHEDULES: 'schedules',
  SETTINGS: 'settings',
  META: 'meta',
  AI_CONFIG: 'ai',
  DATA_CONTACTS: 'data.contacts',
  DATA_INBOX: 'data.inbox',
  DATA_OUTREACH: 'data.outreach',
  DATA_PROFILE_REVIEWS: 'data.profileReviews',
  DATA_ACTIVITY_LOG: 'data.activityLog',
  DATA_SEQUENCES: 'data.sequences',
  COHORT: 'cohort',
  SIDECAR: 'sidecar'
};

export const DEFAULT_AI_CONFIG = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  model: 'llama3.1:8b',
  maxTokens: 1024,
  // Optional system-prompt prefix. Injected before the first system message.
  prependSystem: '',
  // Optional user-message prefix. Injected before the first user message.
  // Qwen3.x honors '/no_think' as a user-side directive (it is ignored when
  // placed in the system prompt), so this is the right slot for chain-of-
  // thought suppression on substitute proxies that route to Qwen.
  prependUser: ''
};

export const DEFAULT_DAILY_LIMITS = {
  'accept-invites': 5,
  'deny-invites': 5,
  'bulk-connect': 3,
  'extract-contacts': 10,
  'inbox-analysis': 10,
  'draft-reply': 30,
  'ai-profile-review': 10,
  'send-message': 25,
  'search-extract': 10,
  'smart-outreach': 3,
  'warm-outreach': 3,
  'warm-visit': 15,
  'harvest-commenters': 10,
  'ai-draft-post': 5,
  'ai-comment': 10,
  'track-posts': 10,
  'cohort-engage': 3,
  'cohort-repost': 5
};

// Map playbook IDs to the LinkedIn page they need
export const PLAYBOOK_URLS = {
  'accept-invites': 'https://www.linkedin.com/mynetwork/invitation-manager/',
  'deny-invites': 'https://www.linkedin.com/mynetwork/invitation-manager/',
  'bulk-connect': 'https://www.linkedin.com/search/results/people/',
  'ai-profile-review': null, // works on any /in/ page
  'extract-contacts': 'https://www.linkedin.com/mynetwork/invite-connect/connections/',
  'inbox-analysis': 'https://www.linkedin.com/messaging/',
  'draft-reply': null, // user opens the thread; button appears on /messaging/thread/...
  'send-message': null, // works on any /in/ page
  'search-extract': 'https://www.linkedin.com/search/results/people/',
  'smart-outreach': null, // meta-playbook, creates a sequence
  'warm-outreach': null,
  'warm-visit': null,
  'harvest-commenters': null, // works on any post
  'ai-draft-post': 'https://www.linkedin.com/feed/',
  'ai-comment': 'https://www.linkedin.com/feed/',
  'track-posts': null, // works on own profile
  'cohort-engage': null,
  'cohort-repost': 'https://www.linkedin.com/feed/'
};

export const EXTENSION_UI_CLASSES = {
  ACTION_BUTTONS: 'li-bulk-action-buttons',
  CONNECT_BUTTON: 'li-bulk-connect-button',
  OVERLAY_ID: 'li-bulk-overlay',
  CONNECT_WRAPPER_ID: 'li-bulk-connect-wrapper'
};

// Known LinkedIn shadow DOM hosts that may contain modals/overlays
export const SHADOW_HOSTS = [
  '#artdeco-modal-outlet'
];

// LinkedIn containers that may hold security challenge messages
export const SECURITY_CONTAINERS = [
  '[role="dialog"]',
  '[role="alert"]',
  '.artdeco-modal',
  '.challenge-page',
  '.security-challenge',
  '.error-message',
  '.captcha-container'
];

/**
 * Format an ISO timestamp as a human-readable "time ago" string.
 * @param {string} iso
 * @returns {string}
 */
export function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export const SECURITY_MESSAGES = [
  'security check',
  'please verify you are not a robot',
  'confirm you are not a robot',
  'unusual amount of activity',
  'too many requests',
  'rate limit exceeded',
  'try again later'
];
