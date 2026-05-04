/**
 * Message types for chrome.runtime messaging between background and content scripts.
 */

// Background ↔ Content
export const MSG = {
  // Settings
  GET_SETTINGS: 'getSettings',
  SET_SETTINGS: 'setSettings',

  // Playbook lifecycle
  RUN_PLAYBOOK: 'runPlaybook',
  STOP_PLAYBOOK: 'stopPlaybook',
  GET_STATUS: 'getPlaybookStatus',
  PLAYBOOK_STATUS: 'playbookStatus',

  // Playbook/selector CRUD
  GET_PLAYBOOK: 'getPlaybook',
  GET_ALL_PLAYBOOKS: 'getAllPlaybooks',
  SAVE_PLAYBOOK: 'savePlaybook',
  DELETE_PLAYBOOK: 'deletePlaybook',
  GET_SELECTORS: 'getSelectors',
  SAVE_SELECTORS: 'saveSelectors',

  // Scheduling
  GET_SCHEDULES: 'getSchedules',
  SET_SCHEDULE: 'setSchedule',
  DELETE_SCHEDULE: 'deleteSchedule',

  // Updates
  CHECK_UPDATES: 'checkUpdates',

  // AI
  AI_REQUEST: 'aiRequest',
  AI_CONFIGURE: 'aiConfigure',
  AI_STATUS: 'aiStatus',
  AI_INTERACTIVE_STEP: 'aiInteractiveStep',

  // Data store
  STORE_DATA: 'storeData',
  GET_DATA: 'getData',
  DELETE_DATA: 'deleteData',
  EXPORT_DATA: 'exportData',
  LOG_ACTIVITY: 'logActivity',
  GET_DAILY_LIMITS: 'getDailyLimits',
  SET_DAILY_LIMITS: 'setDailyLimits',

  // Sequences
  CREATE_SEQUENCE: 'createSequence',
  GET_SEQUENCES: 'getSequences',
  GET_SEQUENCE: 'getSequence',
  DELETE_SEQUENCE: 'deleteSequence',
  ENROLL_CONTACTS: 'enrollContacts',
  MARK_REPLIED: 'markReplied',
  PROCESS_SEQUENCES: 'processSequences',
  RECORD_MESSAGE_SENT: 'recordMessageSent',
  SET_SEQUENCE_STATUS: 'setSequenceStatus',
  CHECK_REPLIES: 'checkReplies',
  RESTAGGER_SEQUENCE: 'restaggerSequence',

  // Cohort
  GET_COHORT: 'getCohort',
  SAVE_COHORT: 'saveCohort',
  SYNC_COHORT: 'syncCohort',
  GET_LEADERBOARD: 'getLeaderboard',
  GET_CONTENT_CALENDAR: 'getContentCalendar',
  GET_SHARED_TEMPLATES: 'getSharedTemplates',
  DETECT_WARM_INTROS: 'detectWarmIntros',
  UPLOAD_MY_CONNECTIONS: 'uploadMyConnections',

  // WebSocket bridge
  WS_STATUS: 'wsStatus',
  WS_COMMAND: 'wsCommand',
  WS_RESPONSE: 'wsResponse'
};

// Playbook execution states
export const PLAYBOOK_STATE = {
  IDLE: 'idle',
  RUNNING: 'running',
  STOPPED: 'stopped',
  COMPLETE: 'complete',
  ERROR: 'error'
};

// Trust levels for playbooks
export const TRUST_LEVEL = {
  AUTO: 'auto',         // Runs without user interaction
  REVIEW: 'review',     // AI proposes, user approves destructive actions
  INTERACTIVE: 'interactive' // Full agent loop with user oversight
};

// Actions that are considered "write" (destructive) for trust checks.
// dismissModal is excluded — it's cleanup, not destructive.
export const WRITE_ACTIONS = [
  'click', 'typeText', 'handleInviteModal', 'navigateNext'
];
