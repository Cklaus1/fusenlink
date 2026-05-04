/**
 * Tests for ai-client chat() error path returning estimated usage.
 */
import { chat } from '../src/background/ai-client.js';

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

  test('completion_tokens is capped at 256', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('err'));

    // maxTokens in config is 512 — completion_tokens should be capped at 256
    const result = await chat({ userMessage: 'hi' });
    expect(result.usage.completion_tokens).toBeLessThanOrEqual(256);
  });

  test('successful response still returns real usage (not estimated)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
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
