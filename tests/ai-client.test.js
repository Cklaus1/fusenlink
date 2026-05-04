/**
 * Tests for ai-client chat() error path returning estimated usage.
 */
import { chat, saveConfig } from '../src/background/ai-client.js';

const OLLAMA_CONFIG = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  model: 'llama3.1:8b',
  maxTokens: 512
};

beforeEach(async () => {
  jest.clearAllMocks();
  // Provide a default AI config (localhost Ollama — valid base URL)
  chrome.storage.local.get.mockImplementation((keys, callback) => {
    callback({ ai: OLLAMA_CONFIG });
  });
  chrome.storage.local.set.mockImplementation((items, callback) => {
    if (callback) callback();
  });
  // Reset module-level cachedConfig so each test starts with a clean config read
  await saveConfig(OLLAMA_CONFIG);
});

describe('chat() error path', () => {
  test('returns estimated usage when fetch throws a network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Failed to fetch'));

    const result = await chat({
      systemPrompt: 'You are a test assistant.',
      userMessage: 'Hello, this is a test message with some content.'
    });

    expect(result.content).toBe('');
    expect(result.error).toBe('Failed to fetch');

    // usage must be present and estimated
    expect(result.usage).toBeDefined();
    expect(result.usage.estimated).toBe(true);
    expect(typeof result.usage.prompt_tokens).toBe('number');
    expect(result.usage.prompt_tokens).toBeGreaterThan(0);
    expect(typeof result.usage.completion_tokens).toBe('number');
    expect(result.usage.completion_tokens).toBeGreaterThanOrEqual(0);
  });

  test('returns estimated usage when server responds with 500', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    });

    const result = await chat({
      systemPrompt: 'System',
      userMessage: 'User input here'
    });

    expect(result.content).toBe('');
    expect(result.error).toMatch(/500/);
    expect(result.usage).toBeDefined();
    expect(result.usage.estimated).toBe(true);
    expect(result.usage.prompt_tokens).toBeGreaterThan(0);
  });

  test('prompt_tokens reflects input message length', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('err'));

    const longMessage = 'a'.repeat(400); // 400 chars → ~100 tokens
    const result = await chat({ userMessage: longMessage });

    expect(result.usage.estimated).toBe(true);
    // System prompt default + longMessage: at minimum longMessage / 4 = 100
    expect(result.usage.prompt_tokens).toBeGreaterThanOrEqual(100);
  });

  // Bug 24: error-path estimator now returns full max_tokens (pessimistic for budget safety),
  // not the old min(maxTokens, 256) cap.
  test('completion_tokens on error equals config maxTokens (pessimistic budget)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('err'));

    // config.maxTokens = 512 — completion_tokens should equal 512 (full pessimistic)
    const result = await chat({ userMessage: 'hi' });
    expect(result.usage.completion_tokens).toBe(512);
  });

  test('successful response still returns real usage (not estimated)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        choices: [{ message: { content: 'Hello!' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      })
    });

    const result = await chat({ userMessage: 'hi' });
    expect(result.content).toBe('Hello!');
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
    // Real usage must NOT have the estimated flag
    expect(result.usage.estimated).toBeUndefined();
  });
});

// Bug 5: HTTP 200 with embedded error body
describe('Bug 5 — HTTP 200 with embedded error', () => {
  test('chat() surfaces embedded error from OpenRouter-style 200 response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        error: { message: 'Insufficient credits' }
      })
    });

    const result = await chat({
      systemPrompt: 'System',
      userMessage: 'Hello'
    });

    expect(result.content).toBe('');
    expect(result.error).toMatch(/Provider returned error: Insufficient credits/);
    // usage should be estimated since we threw before extracting real usage
    expect(result.usage).toBeDefined();
    expect(result.usage.estimated).toBe(true);
  });

  test('chat() surfaces string-shaped embedded error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        error: 'rate limit exceeded'
      })
    });

    const result = await chat({ userMessage: 'test' });

    expect(result.error).toMatch(/Provider returned error: rate limit exceeded/);
  });
});

// Bug 18: saveConfig only aborts controllers issued under a different provider/baseUrl
describe('Bug 18 — saveConfig selective abort', () => {
  test('saveConfig with different provider aborts the in-flight request', async () => {
    let callCount = 0;
    let capturedSignal;

    // First call hangs until aborted; second call (retry after abort) rejects immediately
    global.fetch = jest.fn().mockImplementation((_url, opts) => {
      callCount++;
      if (callCount === 1) {
        capturedSignal = opts.signal;
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const abortErr = new Error('The operation was aborted.');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        });
      }
      // Retry call: reject immediately so chatPromise resolves
      return Promise.reject(new Error('Network failure on retry'));
    });

    // Kick off chat against ollama — don't await (it will hang until aborted)
    const chatPromise = chat({ userMessage: 'hello' });

    // Give the event loop ticks so fetch() is actually called
    await new Promise(r => setTimeout(r, 20));

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal.aborted).toBe(false);

    // Calling saveConfig with a DIFFERENT provider should abort the in-flight request
    await saveConfig({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      maxTokens: 512
    });

    expect(capturedSignal.aborted).toBe(true);

    // chatPromise: Bug 19 retries once with new config → second fetch rejects → resolves with error
    const result = await chatPromise;
    expect(result.error).toBeDefined();
  }, 10000);

  test('saveConfig with same provider and baseUrl does NOT abort in-flight request', async () => {
    let capturedSignal;
    let resolveHangingFetch;

    // A fetch that hangs until we manually resolve it
    global.fetch = jest.fn().mockImplementation((_url, opts) => {
      capturedSignal = opts.signal;
      return new Promise((resolve) => {
        resolveHangingFetch = () => resolve({
          ok: true,
          headers: { get: () => null },
          json: async () => ({
            choices: [{ message: { content: 'done' } }],
            usage: { prompt_tokens: 5, completion_tokens: 3 }
          })
        });
        // Also listen for abort so we can detect it
        opts.signal.addEventListener('abort', () => {
          // Don't reject — just record that abort was fired
        });
      });
    });

    // Kick off chat against ollama
    const chatPromise = chat({ userMessage: 'hello' });

    await new Promise(r => setTimeout(r, 20));

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal.aborted).toBe(false);

    // Calling saveConfig with the SAME provider/baseUrl should NOT abort
    await saveConfig({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'llama3.1:8b',
      maxTokens: 512
    });

    // Signal should still not be aborted
    expect(capturedSignal.aborted).toBe(false);

    // Resolve the fetch so chatPromise completes
    resolveHangingFetch();
    const result = await chatPromise;
    expect(result.content).toBe('done');
  }, 10000);
});

// Bug 19: AbortError from saveConfig triggers one retry on the new config
describe('Bug 19 — abort-triggered retry on new config', () => {
  test('chat() retries once after abort caused by saveConfig and succeeds', async () => {
    let callCount = 0;
    let firstSignal;

    global.fetch = jest.fn().mockImplementation((_url, opts) => {
      callCount++;
      if (callCount === 1) {
        // First call: capture signal and abort immediately via saveConfig
        firstSignal = opts.signal;
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const abortErr = new Error('The operation was aborted.');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        });
      }
      // Second call (retry): succeed with a valid response
      return Promise.resolve({
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          choices: [{ message: { content: 'Retry succeeded' } }],
          usage: { prompt_tokens: 5, completion_tokens: 10 }
        })
      });
    });

    const chatPromise = chat({ userMessage: 'test retry' });

    // Wait for fetch to be called
    await new Promise(r => setTimeout(r, 20));

    // Abort by switching to a different provider
    await saveConfig({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      maxTokens: 512
    });

    const result = await chatPromise;

    // The retry should have succeeded
    expect(result.content).toBe('Retry succeeded');
    expect(result.error).toBeUndefined();
    expect(callCount).toBe(2);
  }, 10000);
});

// Bug 32: Smart error message extraction from provider responses
describe('Bug 32 — extractProviderErrorMessage', () => {
  test('extracts error_description from {error: {error_description}} shape', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        error: { error_description: 'Token has expired' }
      })
    });

    const result = await chat({ userMessage: 'test' });
    expect(result.error).toMatch(/Provider returned error: Token has expired/);
  });

  test('extracts detail from top-level {detail: "..."} shape', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        error: { detail: 'Model not found' }
      })
    });

    const result = await chat({ userMessage: 'test' });
    expect(result.error).toMatch(/Provider returned error: Model not found/);
  });

  test('extracts top-level detail when error object is absent', async () => {
    // Simulate a provider that uses top-level detail instead of error.detail
    // This goes through fetchOpenAICompat; data.error must be set to trigger the path
    // We test this via the helper indirectly: use error: {} with no message but top-level detail
    // Actually, the guard is `if (data.error)` — truthy for {}
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        error: {},
        detail: 'Rate limit reached'
      })
    });

    const result = await chat({ userMessage: 'test' });
    // error:{} has no recognized sub-field, so falls through to data.detail
    expect(result.error).toMatch(/Provider returned error: Rate limit reached/);
  });
});

// Bug 24: error-path estimate uses body.max_tokens (pessimistic)
describe('Bug 24 — pessimistic completion estimate on error', () => {
  test('completion_tokens estimate equals body max_tokens when request fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

    const result = await chat({
      userMessage: 'hi',
      maxTokens: 4000
    });

    expect(result.usage.estimated).toBe(true);
    // Should be ~4000, not capped at 256
    expect(result.usage.completion_tokens).toBe(4000);
  });
});
