/**
 * AIClient — provider-agnostic LLM client.
 *
 * Supports any OpenAI-compatible endpoint:
 *   Ollama, vLLM, SGLang, OpenRouter, NVIDIA NIM, OpenAI
 *
 * For Anthropic's native API, an adapter translates the messages format.
 * Or use Anthropic via OpenRouter (recommended).
 *
 * All providers hit POST {baseUrl}/chat/completions with the same shape.
 */

import { STORAGE_KEYS, DEFAULT_AI_CONFIG } from '../shared/constants.js';

let cachedConfig = null;
let configLoading = null; // Prevent concurrent loads

// Bug 13: Track in-flight AbortControllers so saveConfig() can cancel stale requests.
const inFlightControllers = new Set();

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

// Invalidate the cache when AI config is updated from another context (e.g. options page)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEYS.AI_CONFIG]) {
    cachedConfig = null;
    configLoading = null;
  }
});

/**
 * Validate that a baseUrl is a well-formed HTTP(S) URL.
 * Localhost (for Ollama/vLLM) is allowed over HTTP; all others require HTTPS.
 * @param {string} url
 * @returns {boolean}
 */
function isValidBaseUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Load AI config from storage.
 * @returns {Promise<Object>}
 */
async function getConfig() {
  if (cachedConfig) return cachedConfig;

  // Prevent parallel loads from racing
  if (configLoading) return configLoading;

  const promise = new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS.AI_CONFIG, (result) => {
      if (chrome.runtime.lastError) {
        console.warn('AI config load failed:', chrome.runtime.lastError.message);
      }
      cachedConfig = { ...DEFAULT_AI_CONFIG, ...(result?.[STORAGE_KEYS.AI_CONFIG] || {}) };
      configLoading = null;
      resolve(cachedConfig);
    });
  });
  configLoading = promise;

  return promise;
}

/**
 * Save AI config to storage.
 * Bug 13: Aborts all in-flight requests so they don't return stale-provider data.
 * @param {Object} config
 * @returns {Promise<void>}
 */
export async function saveConfig(config) {
  // Abort any in-flight requests so they don't return stale-provider data
  for (const c of inFlightControllers) {
    try { c.abort(); } catch {}
  }
  inFlightControllers.clear();
  cachedConfig = { ...DEFAULT_AI_CONFIG, ...config };
  configLoading = null;
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.AI_CONFIG]: cachedConfig }, resolve);
  });
}

/**
 * Check if AI is configured and reachable.
 * @returns {Promise<{configured: boolean, provider: string, model: string, error?: string}>}
 */
export async function getStatus() {
  const config = await getConfig();

  if (!config.baseUrl) {
    return { configured: false, provider: config.provider, model: config.model, error: 'No baseUrl configured' };
  }

  if (!isValidBaseUrl(config.baseUrl)) {
    return { configured: false, provider: config.provider, model: config.model, error: 'Invalid baseUrl — must be HTTPS (or localhost HTTP)' };
  }

  try {
    // Try a lightweight models list call to check connectivity (5s timeout)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let response;
    try {
      response = await fetch(`${config.baseUrl}/models`, {
        headers: config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {},
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    return {
      configured: true,
      provider: config.provider,
      model: config.model,
      reachable: response.ok
    };
  } catch (err) {
    return {
      configured: true,
      provider: config.provider,
      model: config.model,
      reachable: false,
      error: err.message
    };
  }
}

/**
 * Produce a pessimistic token-usage estimate when a real response is unavailable.
 * Uses ~4 chars/token for English text. Callers can detect this with `usage.estimated`.
 * Bug 24 (error path): Use body.max_tokens as the pessimistic completion estimate
 * so callers don't undercount their budget.
 * @param {Object[]} messages
 * @param {number} [maxTokensRequested]
 * @returns {{prompt_tokens: number, completion_tokens: number, estimated: true}}
 */
function estimateTokens(messages, maxTokensRequested) {
  const promptChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  return {
    prompt_tokens: Math.ceil(promptChars / 4),
    completion_tokens: maxTokensRequested || 1024, // Bug 24: pessimistic — full requested budget
    estimated: true
  };
}

/**
 * Send a chat completion request to the configured LLM provider.
 *
 * @param {Object} params
 * @param {string} params.systemPrompt - System message
 * @param {string} params.userMessage - User message (or stringified data)
 * @param {Object[]} [params.messages] - Full message array (overrides system+user)
 * @param {string} [params.model] - Model override
 * @param {number} [params.maxTokens] - Max tokens override
 * @param {number} [params.temperature=0.7] - Temperature
 * @param {boolean} [params.jsonMode=false] - Request JSON output
 * @returns {Promise<{content: string, parsed?: Object, usage?: Object, error?: string}>}
 */
export async function chat(params) {
  const config = await getConfig();

  const messages = params.messages || [
    { role: 'system', content: params.systemPrompt || 'You are a helpful assistant.' },
    { role: 'user', content: params.userMessage || '' }
  ];

  const body = {
    model: params.model || config.model,
    messages,
    max_tokens: params.maxTokens || config.maxTokens,
    temperature: params.temperature ?? 0.7
  };

  // JSON mode (supported by OpenAI, Ollama, vLLM)
  if (params.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  if (!isValidBaseUrl(config.baseUrl)) {
    return { content: '', error: 'Invalid baseUrl — must be HTTPS (or localhost HTTP)' };
  }

  // Use explicit provider field, not URL pattern matching
  const isAnthropic = config.provider === 'anthropic';

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = isAnthropic
        ? await fetchAnthropic(config, messages, body)
        : await fetchOpenAICompat(config, body);
      return response;
    } catch (err) {
      lastError = err;
      // Abort errors (from timeout or saveConfig) must not be retried
      const isAbort = err.name === 'AbortError' || err.message?.toLowerCase().includes('aborted');
      const isRetryable = !isAbort && err.retryable === true;
      if (!isRetryable || attempt === MAX_RETRIES) break;
      await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
    }
  }

  return {
    content: '',
    error: lastError.message,
    usage: estimateTokens(messages, body.max_tokens)
  };
}

/**
 * Fetch from OpenAI-compatible endpoint.
 */
const FETCH_TIMEOUT_MS = 30000;

async function fetchOpenAICompat(config, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  // Bug 13: Register controller so saveConfig() can abort in-flight requests.
  const controller = new AbortController();
  inFlightControllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
    inFlightControllers.delete(controller);
  }

  if (!response.ok) {
    const errorText = await response.text();
    const safeMessage = `LLM API error ${response.status}`;
    const err = new Error(safeMessage);
    err.retryable = RETRYABLE_STATUSES.has(response.status);
    err.bodyDetail = errorText.slice(0, 500);
    // Bug 19: Gate raw body logging behind debug flag.
    const isDebug = (typeof globalThis !== 'undefined' && globalThis.FUSENLINK_DEBUG)
                 || (typeof localStorage !== 'undefined' && localStorage.getItem('fusenlink_debug') === '1');
    if (isDebug) {
      console.warn(safeMessage, errorText.slice(0, 200));
    } else {
      console.warn(safeMessage); // status code only
    }
    throw err;
  }

  const data = await response.json();

  // Bug 5: HTTP 200 with embedded error body (e.g. OpenRouter "Insufficient credits").
  if (data.error) {
    const msg = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error).slice(0, 200));
    const err = new Error(`Provider returned error: ${msg}`);
    err.retryable = false; // body errors are usually permanent
    err.bodyDetail = JSON.stringify(data.error).slice(0, 500);
    throw err;
  }

  const content = data.choices?.[0]?.message?.content || '';

  // Bug 24: Prefer response headers for usage hints when available.
  const usageFromHeaders = {
    prompt_tokens: parseInt(response.headers.get('x-ratelimit-prompt-tokens') || '0', 10) || undefined,
  };
  const usage = data.usage || usageFromHeaders;

  return { content, parsed: tryParseJSON(content), usage };
}

/**
 * Fetch from Anthropic's native API (messages format).
 * Adapter: translates OpenAI messages → Anthropic format.
 */
async function fetchAnthropic(config, messages, body) {
  // Extract system message
  const systemMsg = messages.find(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system');

  const anthropicBody = {
    model: body.model,
    max_tokens: body.max_tokens,
    system: systemMsg?.content || '',
    messages: userMessages.map(m => ({
      role: m.role,
      content: m.content
    }))
  };

  // Bug 13: Register controller so saveConfig() can abort in-flight requests.
  const controller = new AbortController();
  inFlightControllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}),
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(anthropicBody),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
    inFlightControllers.delete(controller);
  }

  if (!response.ok) {
    const errorText = await response.text();
    const safeMessage = `Anthropic API error ${response.status}`;
    const err = new Error(safeMessage);
    err.retryable = RETRYABLE_STATUSES.has(response.status);
    err.bodyDetail = errorText.slice(0, 500);
    // Bug 19: Gate raw body logging behind debug flag.
    const isDebug = (typeof globalThis !== 'undefined' && globalThis.FUSENLINK_DEBUG)
                 || (typeof localStorage !== 'undefined' && localStorage.getItem('fusenlink_debug') === '1');
    if (isDebug) {
      console.warn(safeMessage, errorText.slice(0, 200));
    } else {
      console.warn(safeMessage); // status code only
    }
    throw err;
  }

  const data = await response.json();

  // Bug 5: Anthropic native API uses {error: {type, message}} shape on HTTP 200 edge cases.
  if (data.error) {
    const msg = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error).slice(0, 200));
    const err = new Error(`Provider returned error: ${msg}`);
    err.retryable = false;
    err.bodyDetail = JSON.stringify(data.error).slice(0, 500);
    throw err;
  }

  const content = data.content?.[0]?.text || '';

  return {
    content,
    parsed: tryParseJSON(content),
    usage: {
      prompt_tokens: data.usage?.input_tokens,
      completion_tokens: data.usage?.output_tokens
    }
  };
}

/**
 * Try to parse a string as JSON. Returns undefined (not null) on failure,
 * so callers can distinguish "not JSON" from "parsed to null".
 */
function tryParseJSON(content) {
  if (!content) return undefined;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}
