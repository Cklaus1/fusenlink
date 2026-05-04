/**
 * HTTP client for communicating with the FusenLink sidecar.
 */

const http = require('http');

const BASE_URL = process.env.FUSENLINK_URL || 'http://localhost:9333';
const AUTH_TOKEN = process.env.FUSENLINK_TOKEN || '';

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
    if (AUTH_TOKEN) {
      headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
    }

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
