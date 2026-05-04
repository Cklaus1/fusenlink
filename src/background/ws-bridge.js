/**
 * WebSocket Bridge — connects the background service worker to the sidecar.
 *
 * The extension is the WebSocket CLIENT, connecting to the sidecar's WS server.
 * This works in MV3 because outbound WebSocket connections are allowed.
 *
 * Auto-reconnects when the service worker wakes up or the connection drops.
 */

import { STORAGE_KEYS } from '../shared/constants.js';

const RECONNECT_ALARM = 'ws-reconnect';
const RECONNECT_MIN_MINUTES = 0.1;  // ~6 seconds
const RECONNECT_MAX_MINUTES = 2;    // 2 minutes
const MAX_RECONNECT_ATTEMPTS = 50;  // Switch to backstop retry after ~50 attempts
const BACKSTOP_BASE_MIN = 30;       // First backstop delay: 30 minutes
const BACKSTOP_MAX_MIN = 24 * 60;   // Maximum backstop delay: 24 hours

let configuredHost = 'localhost';
let configuredPort = 9333;

let socket = null;
let messageHandler = null;
let reconnectDelay = RECONNECT_MIN_MINUTES; // Exponential backoff
let reconnectAttempts = 0;
let consecutiveBackstops = 0;
// Bug 19 fix: don't reset consecutiveBackstops immediately on open — wait for
// the connection to be stable for 30 seconds first so rapid open/close cycles
// (sidecar boots, accepts, then crashes within 100ms) don't prevent escalation.
let stableTimer = null;

function getWsUrl() {
  return `ws://${configuredHost}:${configuredPort}/ws`;
}

async function loadSidecarConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEYS.SIDECAR, (result) => {
      const cfg = result[STORAGE_KEYS.SIDECAR] || {};
      configuredHost = cfg.host || 'localhost';
      configuredPort = cfg.port || 9333;
      resolve();
    });
  });
}

/**
 * Initialize the WebSocket bridge.
 * @param {Function} onMessage - Handler for messages from the sidecar.
 *   Called with (message: Object, respond: (data: Object) => void)
 */
export async function initWsBridge(onMessage) {
  messageHandler = onMessage;

  // Listen for sidecar config changes — moved here so messageHandler is set
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEYS.SIDECAR]) {
      loadSidecarConfig().then(() => {
        if (socket) { try { socket.close(); } catch {} socket = null; }
        reconnectAttempts = 0;
        reconnectDelay = RECONNECT_MIN_MINUTES;
        connect();
      });
    }
  });

  // Listen for reconnect alarm (survives service worker death)
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECONNECT_ALARM) {
      connect();
    }
  });

  await loadSidecarConfig();
  connect();
}

/**
 * Get the current WebSocket status.
 * @returns {{connected: boolean}}
 */
export function getWsStatus() {
  return {
    connected: socket !== null && socket.readyState === WebSocket.OPEN
  };
}

/**
 * Connect to the sidecar WebSocket server.
 */
function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    socket = new WebSocket(getWsUrl());

    socket.addEventListener('open', () => {
      console.log('[ws-bridge] Connected to sidecar');
      reconnectDelay = RECONNECT_MIN_MINUTES; // Reset backoff on success
      reconnectAttempts = 0;
      // Don't reset consecutiveBackstops yet — wait for stability (30s uptime).
      // This prevents a rapid open/close crash loop from resetting the counter
      // before it can escalate to longer backstop delays.
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = setTimeout(() => {
        consecutiveBackstops = 0;
        stableTimer = null;
      }, 30000);
      clearReconnect();

      // Flush any responses that were queued while the socket was closed
      const now = Date.now();
      const toSend = responseQueue.filter(e => (now - e.addedAt) <= QUEUE_TTL_MS);
      responseQueue.length = 0;
      for (const { data } of toSend) {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
      }
    });

    socket.addEventListener('message', (event) => {
      let parsedRequestId;
      try {
        const msg = JSON.parse(event.data);
        parsedRequestId = msg?._requestId;

        // Validate message structure
        if (!msg || typeof msg !== 'object') {
          console.warn('[ws-bridge] Ignoring non-object message');
          return;
        }
        if (!msg.action && !msg.type && !msg._requestId) {
          console.warn('[ws-bridge] Ignoring message without action, type, or _requestId');
          return;
        }

        if (messageHandler) {
          const respond = (data) => {
            send({ ...data, _requestId: parsedRequestId });
          };

          messageHandler(msg, respond);
        }
      } catch (err) {
        console.error('[ws-bridge] Message parse error:', err);
        // Use the requestId extracted before the error, if available
        send({ error: 'Message parse error', _requestId: parsedRequestId });
      }
    });

    socket.addEventListener('close', () => {
      console.log('[ws-bridge] Disconnected from sidecar');
      socket = null;
      // Cancel stability timer — connection didn't hold long enough.
      if (stableTimer) {
        clearTimeout(stableTimer);
        stableTimer = null;
      }
      scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // Error will be followed by close event — let close handler clean up
    });
  } catch (err) {
    console.warn('[ws-bridge] Connection failed:', err.message);
    scheduleReconnect();
  }
}

const responseQueue = [];  // { data, addedAt }
const QUEUE_TTL_MS = 30_000;

/**
 * Send a message to the sidecar.
 * If the socket is not open, queue the response (up to TTL) so it can be
 * flushed when the connection is restored.
 * @param {Object} data
 */
function send(data) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  } else {
    const now = Date.now();
    responseQueue.push({ data, addedAt: now });
    // Expire entries that are too old to be useful
    while (responseQueue.length && (now - responseQueue[0].addedAt) > QUEUE_TTL_MS) {
      responseQueue.shift();
    }
  }
}

/**
 * Schedule a reconnection attempt using chrome.alarms (survives worker death).
 * Uses exponential backoff: 6s → 12s → 24s → ... → 2min max.
 */
function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    // Don't give up entirely — back off to a long-period retry so the bridge
    // recovers when the sidecar starts later.
    // Multiply backstop delay exponentially up to a daily cap to avoid burning
    // battery on a permanently-offline sidecar.
    consecutiveBackstops++;
    const delay = Math.min(
      BACKSTOP_BASE_MIN * Math.pow(2, consecutiveBackstops - 1),
      BACKSTOP_MAX_MIN
    );
    console.warn(`[ws-bridge] Backstop #${consecutiveBackstops}, retry in ${delay} min`);
    chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: delay });
    // Reset fast-retry counters so the next alarm starts fresh fast retries.
    reconnectAttempts = 0;
    reconnectDelay = RECONNECT_MIN_MINUTES;
    return;
  }
  reconnectAttempts++;
  chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: reconnectDelay });
  // Exponential backoff, capped at max
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MINUTES);
}

/**
 * Cancel any pending reconnection.
 */
function clearReconnect() {
  chrome.alarms.clear(RECONNECT_ALARM);
}
