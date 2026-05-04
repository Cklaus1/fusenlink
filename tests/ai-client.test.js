/**
 * Tests for ai-client chat() error path returning estimated usage.
 */
import { chat, saveConfig } from '../src/background/ai-client.js';

beforeEach(() => {
  jest.clearAllMocks();
  // Provide a default AI config (localhost Ollama — valid base URL)
  chrome.storage.local.get.mockImplementation((keys, callback) => {
    callback({
      ai: {
        provider: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.1:8b',
        maxTokens: 512
      }
    });
  });
  chrome.storage.local.set.mockImplementation((items, callback) => {
    if (callback) callback();
  });
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

// Bug 13: saveConfig aborts in-flight requests
describe('Bug 13 — saveConfig aborts in-flight requests', () => {
  test('fetch signal is aborted when saveConfig is called while fetch is pending', async () => {
    let capturedSignal;

    // A fetch that captures its signal and rejects when the abort signal fires
    global.fetch = jest.fn().mockImplementation((_url, opts) => {
      capturedSignal = opts.signal;
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const abortErr = new Error('The operation was aborted.');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });
    });

    // Kick off chat — don't await (it will hang until aborted)
    const chatPromise = chat({ userMessage: 'hello' });

    // Give the event loop ticks so fetch() is actually called
    await new Promise(r => setTimeout(r, 20));

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal.aborted).toBe(false);

    // Calling saveConfig should abort all in-flight controllers
    await saveConfig({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'llama3.1:8b',
      maxTokens: 512
    });

    expect(capturedSignal.aborted).toBe(true);

    // Abort is non-retryable so chat() resolves quickly with an error
    const result = await chatPromise;
    expect(result.error).toBeDefined();
  }, 10000);
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
