/**
 * HTTP client for communicating with the FusenLink sidecar.
 */

const http = require('http');

const BASE_URL = process.env.FUSENLINK_URL || 'http://localhost:9333';
const tokenFromFile = (() => {
  try {
    const f = require('path').join(require('os').homedir(), '.fusenlink', 'sidecar.token');
    return require('fs').readFileSync(f, 'utf8').trim();
  } catch { return null; }
})();
const AUTH_TOKEN = process.env.FUSENLINK_TOKEN || tokenFromFile || '';

// Bug 7 fix: fail fast at module load time if no token is available.
// Skip the check for help / no-command invocations so `fusenlink --help`
// still works without a running sidecar.
const HELP_COMMANDS = new Set(['--help', '-h', 'help', undefined, null, '']);
const _cliCommand = process.argv[2];
if (!AUTH_TOKEN && !HELP_COMMANDS.has(_cliCommand)) {
  console.error('No sidecar auth token found.');
  console.error('  - Start the sidecar:  cd sidecar && npm start');
  console.error('  - Or set:             export FUSENLINK_TOKEN=<token>');
  process.exit(1);
}

/**
 * Make an HTTP request to the sidecar.
 * @param {string} method - GET or POST
 * @param {string} path - API path (e.g., '/api/run')
 * @param {Object} [body] - Request body for POST
 * @returns {Promise<Object>}
 */
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = { 'Content-Type': 'application/json' };
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
      timeout: 60000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new Error('Sidecar not running. Start it with: cd sidecar && npm start'));
      } else {
        reject(err);
      }
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

exports.get = (path) => request('GET', path);
exports.post = (path, body) => request('POST', path, body);
