#!/usr/bin/env node
/**
 * FusenLink WebSocket Sidecar
 *
 * Bridges HTTP requests from the CLI to WebSocket messages consumed
 * by the Chrome extension's background service worker.
 *
 * HTTP :9333/api/*  →  WebSocket :9333/ws  →  Extension background.js
 */

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.FUSENLINK_PORT || 9333;

// Auth token — reuse existing token from ~/.fusenlink/sidecar.token so
// CLI sessions survive sidecar restarts. Generate a new token only when:
//   (a) the file doesn't exist (first run), or
//   (b) --rotate-token[=true] flag is passed (Bug 14), or
//   (c) FUSENLINK_TOKEN env var is explicitly set (use that value, skip file).
const TOKEN_FILE = path.join(os.homedir(), '.fusenlink', 'sidecar.token');

// Bug 14 fix: detect both --rotate-token and --rotate-token=<value> forms.
const ROTATE = process.argv.some(a => a === '--rotate-token' || a.startsWith('--rotate-token='));

/**
 * Load or generate the auth token.
 * Returns { token, isNew } but does NOT write the token file — the write
 * is deferred until after server.listen() succeeds (Bug 12 fix).
 */
function loadOrGenerateToken() {
  if (process.env.FUSENLINK_TOKEN) {
    console.log('  Auth token: provided via FUSENLINK_TOKEN env var.');
    return { token: process.env.FUSENLINK_TOKEN, isNew: false };
  }

  // Bug 14 fix: only skip file read if --rotate-token is absent.
  if (!ROTATE && fs.existsSync(TOKEN_FILE)) {
    try {
      const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
      if (/^[a-f0-9]{32,}$/i.test(t)) {
        console.log(`  Auth token: reusing from ${TOKEN_FILE}`);
        return { token: t, isNew: false };
      }
    } catch {}
  }

  // Generate a new token — do NOT write to file yet (Bug 12: write only after bind).
  const t = crypto.randomBytes(16).toString('hex');
  return { token: t, isNew: true };
}

const tokenInfo = loadOrGenerateToken();
const AUTH_TOKEN = tokenInfo.token;

// Track the connected extension client
let extensionSocket = null;
let pendingRequests = new Map(); // requestId → { resolve, reject, timer }
let requestCounter = 0;

// Create HTTP + WS server
const server = http.createServer(handleHttp);
const wss = new WebSocketServer({ server, path: '/ws' });

// --- WebSocket handling ---

wss.on('connection', (ws) => {
  console.log('[sidecar] Extension connected');
  extensionSocket = ws;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      // Route response back to pending HTTP request
      if (msg._requestId && pendingRequests.has(msg._requestId)) {
        const { resolve, timer } = pendingRequests.get(msg._requestId);
        clearTimeout(timer);
        pendingRequests.delete(msg._requestId);
        resolve(msg);
      }
    } catch (err) {
      console.error('[sidecar] Bad message from extension:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[sidecar] Extension disconnected');
    extensionSocket = null;
  });

  ws.on('error', (err) => {
    console.error('[sidecar] WebSocket error:', err.message);
    extensionSocket = null;
  });
});

// --- HTTP API handling ---

// Bug 23 fix: parse Host header and compare hostname only so that
// `Host: localhost` (no port) is accepted alongside `Host: localhost:9333`.
function isAllowedHost(hostHeader, expectedPort) {
  if (!hostHeader) return false;
  const lower = hostHeader.toLowerCase();
  // Determine hostname and optional port
  const isIPv6 = lower.startsWith('[');
  let hostname, port;
  if (isIPv6) {
    const closeBracket = lower.indexOf(']');
    hostname = lower.slice(0, closeBracket + 1);
    port = lower.slice(closeBracket + 2) || null;
  } else {
    const colonIdx = lower.lastIndexOf(':');
    if (colonIdx > 0) {
      hostname = lower.slice(0, colonIdx);
      port = lower.slice(colonIdx + 1);
    } else {
      hostname = lower;
      port = null;
    }
  }
  // Hostname must be one of the localhost forms
  const allowedHostnames = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (!allowedHostnames.has(hostname)) return false;
  // Port must be absent or match expected port
  if (port && parseInt(port, 10) !== parseInt(expectedPort, 10)) return false;
  return true;
}

async function handleHttp(req, res) {
  // DNS-rebinding protection — only accept connections with a localhost Host header
  const host = req.headers.host || '';
  if (!isAllowedHost(host, PORT)) {
    return jsonResponse(res, { error: 'Invalid Host header. Sidecar accepts only localhost connections.' }, 421);
  }

  // CORS — localhost only, not wildcard
  const origin = req.headers.origin || '';
  if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Health check — no auth required
  if (path === '/api/health') {
    return jsonResponse(res, {
      status: 'ok',
      extensionConnected: extensionSocket !== null && extensionSocket.readyState === WebSocket.OPEN
    });
  }

  // Auth check — require Bearer token on all other endpoints
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!timingSafeEqual(token, AUTH_TOKEN)) {
    return jsonResponse(res, { error: 'Unauthorized. Pass --token or set FUSENLINK_TOKEN.' }, 401);
  }

  // All other routes require extension connection
  if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
    return jsonResponse(res, { error: 'Extension not connected' }, 503);
  }

  try {
    let body = {};
    if (req.method === 'POST') {
      body = await readBody(req);
    }

    let message;

    switch (path) {
      case '/api/run':
        message = { action: 'runPlaybook', type: 'runPlaybook', playbookId: body.playbookId };
        break;
      case '/api/stop':
        message = { action: 'stopPlaybook', type: 'stopPlaybook' };
        break;
      case '/api/status':
        message = { action: 'getPlaybookStatus', type: 'getPlaybookStatus' };
        break;
      case '/api/playbooks':
        message = { action: 'getAllPlaybooks' };
        break;
      case '/api/settings':
        if (req.method === 'POST') {
          message = { action: 'setSettings', settings: body };
        } else {
          message = { action: 'getSettings' };
        }
        break;
      case '/api/schedules':
        message = { action: 'getSchedules' };
        break;
      case '/api/schedule':
        message = { action: 'setSchedule', playbookId: body.playbookId, config: body.config };
        break;
      case '/api/sequences':
        message = { action: 'getSequences' };
        break;
      case '/api/sequence/create':
        message = { action: 'createSequence', ...body };
        break;
      case '/api/sequence/enroll':
        message = { action: 'enrollContacts', sequenceId: body.sequenceId, contacts: body.contacts };
        break;
      case '/api/sequence/delete':
        message = { action: 'deleteSequence', sequenceId: body.sequenceId };
        break;
      case '/api/ai/status':
        message = { action: 'aiStatus' };
        break;
      case '/api/ai/configure':
        message = { action: 'aiConfigure', config: body };
        break;
      case '/api/ai/chat':
        message = { action: 'aiRequest', ...body };
        break;
      default:
        // Data endpoints: /api/data/:collection
        if (path.startsWith('/api/data/')) {
          const collection = path.replace('/api/data/', '');
          const format = url.searchParams.get('format') || 'json';
          const limit = parseInt(url.searchParams.get('limit') || '0', 10);
          if (req.method === 'POST') {
            message = { action: 'storeData', collection, data: body.data, options: body.options };
          } else {
            message = { action: 'getData', collection, options: { format, limit: limit || undefined } };
          }
          break;
        }
        return jsonResponse(res, { error: 'Not found' }, 404);
    }

    // Send to extension and wait for response
    const response = await sendToExtension(message);
    jsonResponse(res, response);
  } catch (err) {
    jsonResponse(res, { error: err.message }, err.status || 500);
  }
}

/**
 * Send a message to the extension via WebSocket and wait for response.
 * @param {Object} message
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<Object>}
 */
function sendToExtension(message, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    // Guard: the extension may not be connected (Chrome closed, FusenLink not
    // loaded, or the bridge hasn't dialed in yet). Without this, the .send()
    // below throws a cryptic "Cannot read properties of null" TypeError.
    if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
      const err = new Error('Extension not connected — open Chrome with FusenLink loaded and a LinkedIn tab');
      err.status = 503;
      reject(err);
      return;
    }

    const requestId = `req_${++requestCounter}`;
    message._requestId = requestId;

    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      const err = new Error('Extension response timeout');
      err.status = 504;
      reject(err);
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timer });
    try {
      extensionSocket.send(JSON.stringify(message));
    } catch (sendErr) {
      // Socket dropped between the readyState check and send (race).
      clearTimeout(timer);
      pendingRequests.delete(requestId);
      const err = new Error('Extension not connected — open Chrome with FusenLink loaded and a LinkedIn tab');
      err.status = 503;
      reject(err);
    }
  });
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

const MAX_BODY_SIZE = 1024 * 1024; // 1MB limit

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Compare against self to keep constant time, then return false
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Start server — Bug 12 fix: bind FIRST, persist token AFTER successful bind
// so that a --rotate-token race with another running sidecar never corrupts
// the token file with an unserviceable token.
server.listen(PORT, () => {
  console.log(`[fusenlink-sidecar] HTTP + WS server on port ${PORT}`);
  console.log(`  HTTP API: http://localhost:${PORT}/api/`);
  console.log(`  WS endpoint: ws://localhost:${PORT}/ws`);

  // Persist a newly-generated token now that we know the bind succeeded.
  if (tokenInfo.isNew && !process.env.FUSENLINK_TOKEN) {
    let persisted = false;
    try {
      const dir = path.dirname(TOKEN_FILE);
      // Bug 13 fix: ensure dir exists with restricted mode; tighten if already present.
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      } else {
        try { fs.chmodSync(dir, 0o700); } catch {}  // tighten existing dir (may fail on Windows)
      }
      fs.writeFileSync(TOKEN_FILE, AUTH_TOKEN, { mode: 0o600 });
      console.log(`  Auth token: generated, saved to ${TOKEN_FILE}`);
      persisted = true;
    } catch (err) {
      console.warn(`  Auth token: failed to persist (${err.message})`);
    }

    // Bug 11 fix: when persistence fails, print the token so the user can
    // set FUSENLINK_TOKEN in their CLI shell and still authenticate.
    if (!persisted) {
      console.log(`  Auth token (memory-only): ${AUTH_TOKEN}`);
      console.log(`  Set FUSENLINK_TOKEN=${AUTH_TOKEN} in your CLI shell before running fusenlink commands.`);
    }
  }

  console.log(`  Waiting for extension to connect...`);
});

// Bug 12 fix: if port is already in use (another sidecar running), exit cleanly
// WITHOUT having written a new token — token file is left unchanged.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[fusenlink-sidecar] Port ${PORT} already in use. Another sidecar may be running.`);
    console.error(`  Did NOT rotate the token — token file is unchanged.`);
    process.exit(1);
  }
  throw err;
});
