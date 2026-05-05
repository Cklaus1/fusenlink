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

// Bug 18: Track in-flight controllers tagged with provider/baseUrl so saveConfig()
// only cancels requests issued under a different provider/baseUrl.
const inFlightControllers = new Set(); // Set<{controller, provider, baseUrl}>

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
 *
 * HTTPS is allowed unconditionally. HTTP is allowed for trusted local /
 * private network destinations:
 *   - loopback: localhost, 127.0.0.1, ::1
 *   - RFC 1918 private: 10/8, 172.16/12, 192.168/16
 *   - Tailscale CGNAT: 100.64.0.0/10
 *   - Tailscale MagicDNS: *.ts.net
 *   - Bare hostnames (no dots): mDNS / LAN / tailnet shortnames like 'gpumaster'
 *
 * @param {string} url
 * @returns {boolean}
 */
function isValidBaseUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol !== 'http:') return false;
    const h = parsed.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1') return true;
    if (/^10\./.test(h)) return true;
    if (/^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;
    if (/\.ts\.net$/.test(h)) return true;
    if (!h.includes('.')) return true; // bare hostname
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
 * Bug 18: Only abort controllers issued under a different provider/baseUrl,
 * so unrelated parallel requests on the same provider continue unaffected.
 * @param {Object} config
 * @returns {Promise<void>}
 */
export async function saveConfig(config) {
  // Bug 6: Validate apiKey for non-localhost providers
  if (config.baseUrl && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(config.baseUrl)) {
    if (!config.apiKey || !config.apiKey.trim()) {
      return { success: false, error: 'apiKey is required for non-localhost providers' };
    }
  }

  const newProvider = config.provider;
  const newBaseUrl = config.baseUrl;
  // Abort only controllers issued against a different provider/baseUrl
  for (const entry of inFlightControllers) {
    if (entry.provider !== newProvider || entry.baseUrl !== newBaseUrl) {
      try { entry.controller.abort(); } catch {}
      inFlightControllers.delete(entry);
    }
  }
  cachedConfig = { ...DEFAULT_AI_CONFIG, ...config };
  configLoading = null;
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.AI_CONFIG]: cachedConfig }, () => resolve({ success: true }));
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

  let lastError;
  let abortRetried = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Bug 19: Re-read config each attempt so an abort caused by saveConfig picks
    // up the new provider config on the retry.
    const currentConfig = await getConfig();
    const isAnthropic = currentConfig.provider === 'anthropic';

    try {
      const response = isAnthropic
        ? await fetchAnthropic(currentConfig, messages, body)
        : await fetchOpenAICompat(currentConfig, body);
      return response;
    } catch (err) {
      lastError = err;
      const isAbort = err.name === 'AbortError' || /aborted/i.test(err.message || '');
      // Bug 19: If aborted (likely by saveConfig), retry once on the new config.
      if (isAbort && !abortRetried) {
        abortRetried = true;
        // Wait for in-flight saveConfig to settle, then retry
        await new Promise(r => setTimeout(r, 100));
        continue;
      }
      const isRetryable = err.retryable === true;
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
 * Bug 32: Extract the most meaningful error message from a provider error response body.
 * Handles common shapes: {error: "string"}, {error: {message}}, {error: {error_description}},
 * {error: {detail}}, {detail}, {message}.
 * @param {*} data
 * @returns {string}
 */
function extractProviderErrorMessage(data) {
  if (!data) return 'Unknown provider error';
  if (typeof data === 'string') return data;
  if (typeof data.error === 'string') return data.error;
  if (data.error?.message) return data.error.message;
  if (data.error?.error_description) return data.error.error_description;
  if (data.error?.detail) return data.error.detail;
  if (data.detail) return data.detail;
  if (data.message) return data.message;
  return JSON.stringify(data).slice(0, 200);
}

/**
 * Fetch from OpenAI-compatible endpoint.
 */
// 120s default — accommodates "thinking" substitute models (Qwen3.x, etc.) that
// emit chain-of-thought before the final answer. Reduce for fast cloud APIs
// via env: FUSENLINK_FETCH_TIMEOUT_MS
const FETCH_TIMEOUT_MS = parseInt(
  (typeof process !== 'undefined' ? process.env?.FUSENLINK_FETCH_TIMEOUT_MS : '') || '120000',
  10
);

async function fetchOpenAICompat(config, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  // Inject prependSystem into the first system message if configured
  const prepend = (config.prependSystem || '').trim();
  if (prepend && Array.isArray(body.messages)) {
    const sysIdx = body.messages.findIndex(m => m.role === 'system');
    if (sysIdx >= 0) {
      const orig = body.messages[sysIdx].content || '';
      body = { ...body, messages: [...body.messages] };
      body.messages[sysIdx] = { ...body.messages[sysIdx], content: orig ? `${prepend}\n\n${orig}` : prepend };
    } else {
      body = { ...body, messages: [{ role: 'system', content: prepend }, ...body.messages] };
    }
  }

  // Bug 18: Register controller tagged with provider/baseUrl so saveConfig() only
  // aborts requests issued under a different provider/baseUrl.
  const controller = new AbortController();
  const entry = { controller, provider: config.provider, baseUrl: config.baseUrl };
  inFlightControllers.add(entry);
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
    inFlightControllers.delete(entry);
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

  // Bug 5 / Bug 32: HTTP 200 with embedded error body (e.g. OpenRouter "Insufficient credits").
  if (data.error) {
    const msg = extractProviderErrorMessage(data);
    const err = new Error(`Provider returned error: ${msg}`);
    err.retryable = false; // body errors are usually permanent
    err.bodyDetail = JSON.stringify(data.error).slice(0, 500);
    throw err;
  }

  // Bug 18: validate response shape — choices array must be present and non-empty
  if (!Array.isArray(data.choices) || data.choices.length === 0) {
    const err = new Error(`Provider returned malformed response (no choices array)`);
    err.retryable = false;
    err.bodyDetail = JSON.stringify(data).slice(0, 500);
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

  // Compose final system prompt with optional prepend (e.g., '/no_think' for
  // Qwen-class substitute models behind a proxy)
  const prepend = (config.prependSystem || '').trim();
  const baseSystem = systemMsg?.content || '';
  const composedSystem = prepend
    ? (baseSystem ? `${prepend}\n\n${baseSystem}` : prepend)
    : baseSystem;

  const anthropicBody = {
    model: body.model,
    max_tokens: body.max_tokens,
    system: composedSystem,
    messages: userMessages.map(m => ({
      role: m.role,
      content: m.content
    }))
  };

  // Bug 18: Register controller tagged with provider/baseUrl so saveConfig() only
  // aborts requests issued under a different provider/baseUrl.
  const controller = new AbortController();
  const entry = { controller, provider: config.provider, baseUrl: config.baseUrl };
  inFlightControllers.add(entry);
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
    inFlightControllers.delete(entry);
  }

  if (!response.ok) {
    const errorText = await response.text();
    let parsedBody;
    try { parsedBody = JSON.parse(errorText); } catch {}
    const detailMsg = parsedBody ? extractProviderErrorMessage(parsedBody) : null;
    const safeMessage = detailMsg
      ? `Anthropic API error ${response.status}: ${detailMsg}`
      : `Anthropic API error ${response.status}`;
    const err = new Error(safeMessage);
    err.retryable = RETRYABLE_STATUSES.has(response.status);
    err.bodyDetail = errorText.slice(0, 500);
    // Bug 19: Gate raw body logging behind debug flag.
    const isDebug = (typeof globalThis !== 'undefined' && globalThis.FUSENLINK_DEBUG)
                 || (typeof localStorage !== 'undefined' && localStorage.getItem('fusenlink_debug') === '1');
    if (isDebug) console.warn(safeMessage, errorText.slice(0, 200));
    else console.warn(safeMessage);
    throw err;
  }

  const data = await response.json();

  // Bug 5 / Bug 32: Anthropic native API uses {error: {type, message}} shape on HTTP 200 edge cases.
  if (data.error) {
    const msg = extractProviderErrorMessage(data);
    const err = new Error(`Provider returned error: ${msg}`);
    err.retryable = false;
    err.bodyDetail = JSON.stringify(data.error).slice(0, 500);
    throw err;
  }

  // Bug 18: validate response shape — content array must be present and non-empty
  if (!Array.isArray(data.content) || data.content.length === 0) {
    const err = new Error(`Anthropic returned malformed response (no content array)`);
    err.retryable = false;
    err.bodyDetail = JSON.stringify(data).slice(0, 500);
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
