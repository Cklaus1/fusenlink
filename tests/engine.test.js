/**
 * Tests for PlaybookEngine
 */
import { PlaybookEngine, classifyError } from '../src/content/engine.js';

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = jest.fn();

// Helper to create a minimal playbook
function makePlaybook(steps, settings = {}) {
  return {
    id: 'test',
    version: 1,
    name: 'Test Playbook',
    steps,
    settings: { delayMs: 10, ...settings }
  };
}

// Minimal selector registry
const emptyRegistry = {};

describe('PlaybookEngine', () => {
  // Bug 9 / Bug 29: the engine reads/writes meta.warnedSafetyCaps on
  // chrome.storage.local. jest-chrome's default mock for storage.local.get
  // doesn't invoke the callback, which would deadlock any test whose loop
  // hits a safetyCap. Provide an in-memory backing here so tests run.
  let _engineLocalStore;
  beforeEach(() => {
    document.body.innerHTML = '';
    _engineLocalStore = new Map();
    chrome.storage.local.get.mockImplementation((keys, callback) => {
      const out = {};
      const k = typeof keys === 'string' ? keys : null;
      if (k) {
        if (_engineLocalStore.has(k)) out[k] = _engineLocalStore.get(k);
      } else if (Array.isArray(keys)) {
        for (const key of keys) if (_engineLocalStore.has(key)) out[key] = _engineLocalStore.get(key);
      } else if (keys && typeof keys === 'object') {
        for (const key of Object.keys(keys)) {
          out[key] = _engineLocalStore.has(key) ? _engineLocalStore.get(key) : keys[key];
        }
      }
      callback(out);
    });
    chrome.storage.local.set.mockImplementation((items, callback) => {
      for (const [k, v] of Object.entries(items)) _engineLocalStore.set(k, v);
      if (callback) callback();
    });
  });

  describe('basic step execution', () => {
    test('setVar sets a variable', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'count', value: 42 }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();
      expect(engine.vars.count).toBe(42);
    });

    test('incrementVar increments a variable', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'count', value: 0 },
        { action: 'incrementVar', var: 'count' },
        { action: 'incrementVar', var: 'count' },
        { action: 'incrementVar', var: 'count' }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();
      expect(engine.vars.count).toBe(3);
    });

    test('incrementVar starts from 0 if undefined', async () => {
      const playbook = makePlaybook([
        { action: 'incrementVar', var: 'newVar' }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();
      expect(engine.vars.newVar).toBe(1);
    });
  });

  describe('DOM operations', () => {
    test('click calls click on resolved element', async () => {
      document.body.innerHTML = '<button id="target">Click Me</button>';
      const btn = document.getElementById('target');
      const spy = jest.spyOn(btn, 'click');

      const registry = {
        myButton: { strategies: [{ type: 'css', value: '#target' }] }
      };

      const playbook = makePlaybook([
        { action: 'find', selector: 'myButton', var: 'btn' },
        { action: 'click', element: '$btn' }
      ]);

      const engine = new PlaybookEngine(playbook, registry);
      await engine.run();
      expect(spy).toHaveBeenCalled();
    });

    test('scroll calls window.scrollTo', async () => {
      const playbook = makePlaybook([
        { action: 'scroll', direction: 'bottom' },
        { action: 'scroll', direction: 'top' }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();
      expect(window.scrollTo).toHaveBeenCalledWith(0, document.body.scrollHeight);
      expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    });

    test('countElements counts matching DOM elements', async () => {
      document.body.innerHTML = `
        <div class="card">1</div>
        <div class="card">2</div>
        <div class="card">3</div>
      `;
      const registry = {
        cards: { strategies: [{ type: 'css', value: '.card' }] }
      };
      const playbook = makePlaybook([
        { action: 'countElements', selector: 'cards', var: 'total' }
      ]);
      const engine = new PlaybookEngine(playbook, registry);
      await engine.run();
      expect(engine.vars.total).toBe(3);
    });

    test('findAll populates array variable', async () => {
      document.body.innerHTML = `
        <button class="action">Accept</button>
        <button class="action">Ignore</button>
      `;
      const registry = {
        allBtns: { strategies: [{ type: 'css', value: 'button.action' }] }
      };
      const playbook = makePlaybook([
        { action: 'findAll', selector: 'allBtns', var: 'btns' }
      ]);
      const engine = new PlaybookEngine(playbook, registry);
      await engine.run();
      expect(engine.vars.btns).toHaveLength(2);
    });
  });

  describe('control flow', () => {
    test('conditional executes onTrue branch', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'x', value: 10 },
        {
          action: 'conditional',
          condition: '$x > 5',
          onTrue: [{ action: 'setVar', var: 'result', value: 'big' }],
          onFalse: [{ action: 'setVar', var: 'result', value: 'small' }]
        }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();
      expect(engine.vars.result).toBe('big');
    });

    test('conditional executes onFalse branch', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'x', value: 2 },
        {
          action: 'conditional',
          condition: '$x > 5',
          onTrue: [{ action: 'setVar', var: 'result', value: 'big' }],
          onFalse: [{ action: 'setVar', var: 'result', value: 'small' }]
        }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();
      expect(engine.vars.result).toBe('small');
    });

    test('loop with breakIf exits correctly', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'i', value: 0 },
        {
          action: 'loop',
          breakIf: '$i >= 3',
          steps: [
            { action: 'incrementVar', var: 'i' }
          ]
        }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();
      expect(engine.vars.i).toBe(3);
    });

    test('loop respects stopRequested', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'i', value: 0 },
        {
          action: 'loop',
          steps: [
            { action: 'incrementVar', var: 'i' },
            { action: 'wait', ms: 10 } // yield to event loop so setTimeout can fire
          ]
        }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);

      // Stop after a short delay
      setTimeout(() => engine.stop(), 50);

      await engine.run();
      expect(engine.vars.i).toBeGreaterThan(0);
      expect(engine.stopRequested).toBe(true);
    });

    test('break action exits loop', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'i', value: 0 },
        {
          action: 'loop',
          steps: [
            { action: 'incrementVar', var: 'i' },
            {
              action: 'conditional',
              condition: '$i >= 5',
              onTrue: [{ action: 'break' }]
            }
          ]
        }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();
      expect(engine.vars.i).toBe(5);
    });

    test('forEach iterates over array', async () => {
      document.body.innerHTML = `
        <button>A</button>
        <button>B</button>
        <button>C</button>
      `;
      const registry = {
        btns: { strategies: [{ type: 'css', value: 'button' }] }
      };
      const playbook = makePlaybook([
        { action: 'setVar', var: 'clickCount', value: 0 },
        { action: 'findAll', selector: 'btns', var: 'buttons' },
        {
          action: 'forEach',
          items: '$buttons',
          itemVar: 'btn',
          steps: [
            { action: 'click', element: '$btn' },
            { action: 'incrementVar', var: 'clickCount' }
          ]
        }
      ]);
      const engine = new PlaybookEngine(playbook, registry);
      await engine.run();
      expect(engine.vars.clickCount).toBe(3);
    });

    test('forEach with breakIf', async () => {
      document.body.innerHTML = `
        <button>A</button>
        <button>B</button>
        <button>C</button>
      `;
      const registry = {
        btns: { strategies: [{ type: 'css', value: 'button' }] }
      };
      const playbook = makePlaybook([
        { action: 'setVar', var: 'clickCount', value: 0 },
        { action: 'findAll', selector: 'btns', var: 'buttons' },
        {
          action: 'forEach',
          items: '$buttons',
          itemVar: 'btn',
          breakIf: '$clickCount >= 2',
          steps: [
            { action: 'click', element: '$btn' },
            { action: 'incrementVar', var: 'clickCount' }
          ]
        }
      ]);
      const engine = new PlaybookEngine(playbook, registry);
      await engine.run();
      expect(engine.vars.clickCount).toBe(2);
    });
  });

  describe('variable resolution', () => {
    test('resolves $settings references', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'myDelay', value: '$settings.delayMs' }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry, { delayMs: 2000 });
      await engine.run();
      // $settings.delayMs is a string, resolveValue returns the number
      expect(engine.vars.myDelay).toBe(2000);
    });
  });

  describe('run results', () => {
    test('returns processedCount and skippedCount', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'processedCount', value: 5 },
        { action: 'setVar', var: 'skippedCount', value: 2 }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      const result = await engine.run();
      expect(result.processedCount).toBe(5);
      expect(result.skippedCount).toBe(2);
      expect(result.stopped).toBe(false);
    });

    test('stopped flag set when stop() called', async () => {
      const playbook = makePlaybook([
        {
          action: 'loop',
          steps: [{ action: 'wait', ms: 10 }]
        }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      setTimeout(() => engine.stop(), 30);
      const result = await engine.run();
      expect(result.stopped).toBe(true);
    });

    test('returns error field when a step throws', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'processedCount', value: 0 }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);

      // Patch _executeStep to throw on second call
      const origExec = engine._executeStep.bind(engine);
      let calls = 0;
      engine._executeStep = async (step) => {
        calls++;
        if (calls === 2) {
          throw new Error('boom');
        }
        return origExec(step);
      };
      // Add a second step so the throw fires
      playbook.steps.push({ action: 'setVar', var: 'x', value: 1 });

      const result = await engine.run();
      expect(result.error).toBe('boom');
      expect(result.processedCount).toBe(0);
      expect(result.skippedCount).toBe(0);
    });

    test('wait returns early when engine.stop() is called mid-wait', async () => {
      const playbook = makePlaybook([
        { action: 'wait', ms: 5000 }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);

      const start = Date.now();
      // Stop after a short delay
      setTimeout(() => engine.stop(), 100);
      const result = await engine.run();
      const elapsed = Date.now() - start;

      // Should finish well before the 5s wait
      expect(elapsed).toBeLessThan(2000);
      expect(result.stopped).toBe(true);
    });
  });

  describe('interactive mode', () => {
    let originalSendMessage;

    beforeEach(() => {
      originalSendMessage = chrome.runtime.sendMessage.getMockImplementation();
    });

    afterEach(() => {
      // Restore the previous default implementation from setup.js
      chrome.runtime.sendMessage.mockImplementation(originalSendMessage);
    });

    test('writes activity log entry on completion via LOG_ACTIVITY', async () => {
      const calls = [];
      // Stub sendMessage: return a "done" plan immediately so the loop exits cleanly.
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        calls.push(message);
        if (message.action === 'aiRequest') {
          callback({
            parsed: { done: true, summary: 'Done!' },
            usage: { prompt_tokens: 10, completion_tokens: 5 }
          });
        } else {
          // Generic ack for LOG_ACTIVITY, etc.
          callback({ success: true });
        }
      });

      const playbook = {
        id: 'interactive-1',
        version: 1,
        name: 'Interactive Test',
        trustLevel: 'interactive',
        userRequest: 'Test the interactive mode',
        steps: [],
        settings: { delayMs: 10, maxCycles: 3 }
      };

      const engine = new PlaybookEngine(playbook, emptyRegistry);
      const result = await engine.run();

      // Activity log was written via the new LOG_ACTIVITY route, not STORE_DATA
      const logCall = calls.find(c => c.action === 'logActivity');
      expect(logCall).toBeDefined();
      expect(logCall.entry).toBeDefined();
      expect(logCall.entry.playbookId).toBe('interactive-1');
      expect(logCall.entry.outcome).toBe('complete');
      expect(logCall.entry.action).toBe('playbook_run');
      expect(logCall.entry.summary).toBe('Done!');
      // Old STORE_DATA path should NOT be used for activityLog anymore
      const storeDataCall = calls.find(c => c.action === 'storeData' && c.collection === 'activityLog');
      expect(storeDataCall).toBeUndefined();
      // Summary captured from done payload
      expect(result.summary).toBe('Done!');
      expect(typeof result.tokensUsed).toBe('number');
    });

    test('_finalize summary text uses result.summary when present', async () => {
      const Overlay = require('../src/ui/overlay.js');
      const showSummarySpy = jest.spyOn(Overlay, 'showSummary').mockImplementation(() => {});

      try {
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
          if (message.action === 'aiRequest') {
            callback({
              parsed: { done: true, summary: 'AI summary text here' },
              usage: { prompt_tokens: 1, completion_tokens: 1 }
            });
          } else {
            callback({ success: true });
          }
        });

        const playbook = {
          id: 'interactive-summary',
          version: 1,
          name: 'Summary Test',
          trustLevel: 'interactive',
          userRequest: 'Capture the summary',
          steps: [],
          settings: { delayMs: 10, maxCycles: 2 }
        };

        const engine = new PlaybookEngine(playbook, emptyRegistry);
        await engine.run();

        // Overlay should display the AI summary, not the "Completed - 0 processed" fallback.
        expect(showSummarySpy).toHaveBeenCalled();
        const lastArg = showSummarySpy.mock.calls[showSummarySpy.mock.calls.length - 1][0];
        expect(lastArg).toContain('AI summary text here');
        expect(lastArg).not.toContain('Completed');
      } finally {
        showSummarySpy.mockRestore();
      }
    });

    test('_finalize summary text uses processedCount when result.summary absent', async () => {
      const Overlay = require('../src/ui/overlay.js');
      const showSummarySpy = jest.spyOn(Overlay, 'showSummary').mockImplementation(() => {});

      try {
        const playbook = makePlaybook([
          { action: 'setVar', var: 'processedCount', value: 7 }
        ]);
        const engine = new PlaybookEngine(playbook, emptyRegistry);
        await engine.run();

        expect(showSummarySpy).toHaveBeenCalled();
        const lastArg = showSummarySpy.mock.calls[showSummarySpy.mock.calls.length - 1][0];
        expect(lastArg).toContain('Completed');
        expect(lastArg).toContain('7 processed');
      } finally {
        showSummarySpy.mockRestore();
      }
    });

    test('previousResults is bounded — large arrays are truncated to head/tail summary', async () => {
      let lastInput = null;
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        if (message.action === 'aiRequest') {
          // Capture the input we send to the AI on the second cycle.
          lastInput = message.input;
          callback({
            parsed: { done: true, summary: 'ok' },
            usage: { prompt_tokens: 1, completion_tokens: 1 }
          });
        } else {
          callback({ success: true });
        }
      });

      const playbook = {
        id: 'bounded',
        version: 1,
        name: 'Bounded Test',
        trustLevel: 'interactive',
        userRequest: 'check bounds',
        steps: [],
        settings: { delayMs: 1, maxCycles: 1 }
      };
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      // Pre-populate vars with a huge array and a huge string to verify the
      // bounded snapshot helper. Run one cycle so previousResults is built;
      // since we return done=true on the first cycle, lastInput won't have
      // previousResults — assert directly on the helper instead.
      engine.vars.bigArr = Array.from({ length: 100 }, (_, i) => i);
      engine.vars.bigStr = 'x'.repeat(2000);
      const snap = engine._boundedVarsSnapshot();
      expect(snap.bigArr._type).toBe('array');
      expect(snap.bigArr.length).toBe(100);
      expect(snap.bigArr.head).toEqual([0, 1, 2]);
      expect(snap.bigArr.tail).toEqual([97, 98, 99]);
      expect(typeof snap.bigStr).toBe('string');
      expect(snap.bigStr.length).toBeLessThan(600);
      expect(snap.bigStr).toContain('truncated');
      // Run normally to make sure nothing else broke.
      await engine.run();
    });

    test('halts when token budget exceeded', async () => {
      let aiCallCount = 0;
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        if (message.action === 'aiRequest') {
          aiCallCount++;
          callback({
            parsed: {
              reasoning: 'keep going',
              steps: [{ action: 'log', message: 'tick' }],
              done: false
            },
            usage: { prompt_tokens: 50000, completion_tokens: 0 }
          });
        } else {
          callback({ success: true });
        }
      });

      const playbook = {
        id: 'interactive-budget',
        version: 1,
        name: 'Budget Test',
        trustLevel: 'interactive',
        userRequest: 'Loop until budget',
        steps: [],
        settings: { delayMs: 10, maxCycles: 10, maxTokensBudget: 60000 }
      };

      const engine = new PlaybookEngine(playbook, emptyRegistry);
      const result = await engine.run();

      // After cycle 1 (50000 used) we are still under 60000, so we keep going.
      // After cycle 2 (100000 used) we exceed budget and break.
      expect(aiCallCount).toBeLessThanOrEqual(2);
      expect(result.tokensUsed).toBeGreaterThan(60000);
    });
  });

  describe('REVIEW trust-level batch approval (Bug 6)', () => {
    let aiPanel;
    let promptSpy;

    beforeEach(() => {
      aiPanel = require('../src/ui/ai-panel.js');
    });

    afterEach(() => {
      if (promptSpy) promptSpy.mockRestore();
    });

    test('one prompt approves the next 10 write actions', async () => {
      document.body.innerHTML = '';
      const html = Array.from({ length: 12 }, (_, i) => `<button class="b${i}">B${i}</button>`).join('');
      document.body.innerHTML = html;

      const registry = {};
      for (let i = 0; i < 12; i++) {
        registry[`b${i}`] = { strategies: [{ type: 'css', value: `.b${i}` }] };
      }

      const steps = [];
      for (let i = 0; i < 12; i++) {
        steps.push({ action: 'find', selector: `b${i}`, var: `el${i}` });
        steps.push({ action: 'click', element: `$el${i}` });
      }

      const playbook = {
        id: 'review-batch',
        version: 1,
        name: 'Review Batch',
        urlPattern: 'test',
        trustLevel: 'review',
        steps,
        settings: { delayMs: 1, reviewBatchSize: 10 }
      };

      let promptCalls = 0;
      promptSpy = jest.spyOn(aiPanel, 'showPrompt').mockImplementation(({ options }) => {
        promptCalls++;
        const label = options.find(o => o.startsWith('Approve next'));
        return Promise.resolve(label);
      });

      const engine = new PlaybookEngine(playbook, registry);
      await engine.run();

      // 12 click actions; one prompt covers writes 1..10, second prompt
      // for writes 11..12.
      expect(promptCalls).toBe(2);
    });

    test('"Approve all" suppresses prompts for the rest of the run', async () => {
      document.body.innerHTML = '';
      const html = Array.from({ length: 25 }, (_, i) => `<button class="b${i}">B${i}</button>`).join('');
      document.body.innerHTML = html;

      const registry = {};
      const steps = [];
      for (let i = 0; i < 25; i++) {
        registry[`b${i}`] = { strategies: [{ type: 'css', value: `.b${i}` }] };
        steps.push({ action: 'find', selector: `b${i}`, var: `el${i}` });
        steps.push({ action: 'click', element: `$el${i}` });
      }

      const playbook = {
        id: 'review-all',
        version: 1,
        name: 'Review All',
        urlPattern: 'test',
        trustLevel: 'review',
        steps,
        settings: { delayMs: 1, reviewBatchSize: 10 }
      };

      let promptCalls = 0;
      promptSpy = jest.spyOn(aiPanel, 'showPrompt').mockImplementation(() => {
        promptCalls++;
        return Promise.resolve('Approve all');
      });

      const engine = new PlaybookEngine(playbook, registry);
      await engine.run();

      expect(promptCalls).toBe(1);
    });

    test('"Stop" terminates the engine', async () => {
      document.body.innerHTML = '<button class="b0">B0</button><button class="b1">B1</button>';
      const registry = {
        b0: { strategies: [{ type: 'css', value: '.b0' }] },
        b1: { strategies: [{ type: 'css', value: '.b1' }] }
      };
      const playbook = {
        id: 'review-stop',
        version: 1,
        name: 'Review Stop',
        urlPattern: 'test',
        trustLevel: 'review',
        steps: [
          { action: 'find', selector: 'b0', var: 'e0' },
          { action: 'click', element: '$e0' },
          { action: 'find', selector: 'b1', var: 'e1' },
          { action: 'click', element: '$e1' }
        ],
        settings: { delayMs: 1, reviewBatchSize: 10 }
      };

      promptSpy = jest.spyOn(aiPanel, 'showPrompt').mockResolvedValue('Stop');

      const engine = new PlaybookEngine(playbook, registry);
      const result = await engine.run();
      expect(result.stopped).toBe(true);
    });

    test('button labels reflect the configured reviewBatchSize', async () => {
      document.body.innerHTML = '<button class="b">x</button>';
      const registry = { b: { strategies: [{ type: 'css', value: '.b' }] } };
      const playbook = {
        id: 'review-label',
        version: 1,
        name: 'Review Label',
        urlPattern: 'test',
        trustLevel: 'review',
        steps: [
          { action: 'find', selector: 'b', var: 'el' },
          { action: 'click', element: '$el' }
        ],
        settings: { delayMs: 1, reviewBatchSize: 25 }
      };

      let capturedOptions = null;
      promptSpy = jest.spyOn(aiPanel, 'showPrompt').mockImplementation(({ options }) => {
        capturedOptions = options;
        return Promise.resolve('Skip');
      });

      const engine = new PlaybookEngine(playbook, registry);
      await engine.run();
      expect(capturedOptions).toEqual(expect.arrayContaining(['Approve next 25', 'Approve all', 'Skip', 'Stop']));
    });
  });

  describe('checkpoint emission (Bug 9)', () => {
    test('loop emits a checkpoint every 10 iterations', async () => {
      const calls = [];
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        calls.push(message);
        callback({ success: true });
      });

      const playbook = makePlaybook([
        { action: 'setVar', var: 'i', value: 0 },
        {
          action: 'loop',
          breakIf: '$i >= 25',
          steps: [{ action: 'incrementVar', var: 'i' }]
        }
      ]);

      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();

      const checkpoints = calls.filter(
        c => c.action === 'logActivity' && c.entry?.action === 'playbook_checkpoint'
      );
      // After 10 and 20 iterations (loop runs 25 times).
      expect(checkpoints.length).toBe(2);
      expect(checkpoints[0].entry.outcome).toBe('in_progress');
    });

    test('forEach emits a checkpoint every 10 iterations', async () => {
      const calls = [];
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        calls.push(message);
        callback({ success: true });
      });

      const playbook = makePlaybook([
        { action: 'setVar', var: 'items', value: Array.from({ length: 21 }, (_, i) => i) },
        {
          action: 'forEach',
          items: '$items',
          itemVar: 'item',
          steps: [{ action: 'incrementVar', var: 'processedCount' }]
        }
      ]);

      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();

      const checkpoints = calls.filter(
        c => c.action === 'logActivity' && c.entry?.action === 'playbook_checkpoint'
      );
      expect(checkpoints.length).toBe(2);
    });
  });

  describe('loop maxIterations safety cap (Bug 11)', () => {
    test('loop with maxIterations stops at the cap', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'i', value: 0 },
        {
          action: 'loop',
          maxIterations: 5,
          steps: [{ action: 'incrementVar', var: 'i' }]
        }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();
      expect(engine.vars.i).toBe(5);
    });

    test('loop with both breakIf and maxIterations honors whichever fires first', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'i', value: 0 },
        {
          action: 'loop',
          breakIf: '$i >= 3',
          maxIterations: 100,
          steps: [{ action: 'incrementVar', var: 'i' }]
        }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();
      expect(engine.vars.i).toBe(3);
    });
  });

  describe('lastError surfaced after handler throw (Bug 35)', () => {
    test('engine.vars.lastError is set when an action throws', async () => {
      const { ACTION_REGISTRY } = require('../src/content/actions/index.js');
      const originalClick = ACTION_REGISTRY.click;
      ACTION_REGISTRY.click = () => { throw new Error('boom from click'); };

      const playbook = makePlaybook([
        { action: 'setVar', var: 'before', value: 1 },
        { action: 'click', element: 'placeholder' }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);

      try {
        await engine.run();
        expect(engine.vars.lastError).toBe('boom from click');
      } finally {
        ACTION_REGISTRY.click = originalClick;
      }
    });
  });

  describe('lastError cleared between iterations (Bug 11)', () => {
    test('forEach clears lastError at the start of each iteration', async () => {
      const { ACTION_REGISTRY } = require('../src/content/actions/index.js');
      const seenAtStart = [];
      ACTION_REGISTRY.__captureLastError = (step, engine) => {
        seenAtStart.push(engine.vars.lastError);
      };

      try {
        const playbook = makePlaybook([
          { action: 'setVar', var: 'items', value: [1, 2, 3] },
          // Pre-set a stale lastError to simulate a prior failure.
          { action: 'setVar', var: 'lastError', value: 'stale' },
          {
            action: 'forEach',
            items: '$items',
            itemVar: 'item',
            steps: [{ action: '__captureLastError' }]
          }
        ]);
        const engine = new PlaybookEngine(playbook, emptyRegistry);
        await engine.run();
        // Every iteration should observe a cleared (undefined) lastError.
        expect(seenAtStart).toEqual([undefined, undefined, undefined]);
      } finally {
        delete ACTION_REGISTRY.__captureLastError;
      }
    });

    test('loop clears lastError at the start of each iteration', async () => {
      const { ACTION_REGISTRY } = require('../src/content/actions/index.js');
      const observed = [];
      ACTION_REGISTRY.__capture = (step, engine) => {
        observed.push(engine.vars.lastError);
      };

      try {
        const playbook = makePlaybook([
          { action: 'setVar', var: 'i', value: 0 },
          { action: 'setVar', var: 'lastError', value: 'stale-from-prior-run' },
          {
            action: 'loop',
            breakIf: '$i >= 3',
            steps: [
              { action: '__capture' },
              { action: 'incrementVar', var: 'i' }
            ]
          }
        ]);
        const engine = new PlaybookEngine(playbook, emptyRegistry);
        await engine.run();
        // Each loop iteration must observe a cleared lastError.
        expect(observed).toEqual([undefined, undefined, undefined]);
      } finally {
        delete ACTION_REGISTRY.__capture;
      }
    });
  });

  describe('safetyCap (Bug 12)', () => {
    test('safetyCap alone caps the loop', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'i', value: 0 },
        {
          action: 'loop',
          safetyCap: 7,
          steps: [{ action: 'incrementVar', var: 'i' }]
        }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();
      expect(engine.vars.i).toBe(7);
    });

    test('safetyCap takes priority over legacy maxIterations', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'i', value: 0 },
        {
          action: 'loop',
          safetyCap: 3,
          maxIterations: 100,
          steps: [{ action: 'incrementVar', var: 'i' }]
        }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();
      expect(engine.vars.i).toBe(3);
    });

    test('legacy maxIterations still works when safetyCap is absent', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'i', value: 0 },
        {
          action: 'loop',
          maxIterations: 4,
          steps: [{ action: 'incrementVar', var: 'i' }]
        }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();
      expect(engine.vars.i).toBe(4);
    });

    test('breakIf still wins if it fires before safetyCap', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'i', value: 0 },
        {
          action: 'loop',
          breakIf: '$i >= 2',
          safetyCap: 100,
          steps: [{ action: 'incrementVar', var: 'i' }]
        }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();
      expect(engine.vars.i).toBe(2);
    });

    // Bug 8: when the author has provided a breakIf, the engine should trust
    // them and default the cap to Infinity. Previously the implicit 10000 cap
    // (and a former 10000 typo) silently truncated long-running playbooks.
    test('breakIf without explicit safetyCap defaults cap to Infinity', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'i', value: 0 },
        {
          action: 'loop',
          breakIf: '$i >= 12000',
          steps: [{ action: 'incrementVar', var: 'i' }]
        }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();
      // Would be capped at 10000 with the old default — now reaches 12000.
      expect(engine.vars.i).toBe(12000);
    });

    test('no breakIf and no explicit cap falls back to 10000 safety net', async () => {
      const playbook = makePlaybook([
        { action: 'setVar', var: 'i', value: 0 },
        // No breakIf provided. Validator would normally reject this; the
        // engine still applies a hard fallback cap so a buggy playbook can't
        // hang the page indefinitely.
        {
          action: 'loop',
          steps: [{ action: 'incrementVar', var: 'i' }]
        }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await engine.run();
        expect(engine.vars.i).toBe(10000);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  // Bug 27 / Bug 9 / Bug 29: a hot loop hitting a safetyCap previously logged
  // a warning every single iteration once it was past the cap. We now log
  // once per playbookId, with a 24h TTL persisted in chrome.storage.local so
  // the cache survives SW sleeps and fresh engine instances.
  describe('safetyCap warn dedup (Bug 9 / Bug 27 / Bug 29)', () => {
    // The parent describe sets up an in-memory chrome.storage.local mock
    // and resets it per test. We reach into _engineLocalStore from the
    // outer scope when a test needs to age stored timestamps.

    // Helper: spin up a playbook whose loop will hit safetyCap.
    const capRunbook = (id) => ({
      id,
      version: 1,
      name: id,
      steps: [
        { action: 'setVar', var: 'i', value: 0 },
        { action: 'loop', safetyCap: 3, steps: [{ action: 'incrementVar', var: 'i' }] }
      ],
      settings: { delayMs: 1 }
    });

    test('warns at most once per playbookId in a single run', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const playbook = makePlaybook([
          { action: 'setVar', var: 'i', value: 0 },
          { action: 'loop', safetyCap: 3, steps: [{ action: 'incrementVar', var: 'i' }] },
          { action: 'setVar', var: 'j', value: 0 },
          { action: 'loop', safetyCap: 3, steps: [{ action: 'incrementVar', var: 'j' }] }
        ]);
        const engine = new PlaybookEngine(playbook, emptyRegistry);
        await engine.run();

        const safetyWarns = warnSpy.mock.calls.filter(
          args => typeof args[0] === 'string' && args[0].includes('safetyCap')
        );
        expect(safetyWarns.length).toBe(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    test('first run warns; second engine instance within 24h skips the warn', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const engine1 = new PlaybookEngine(capRunbook('cap-pb-1'), emptyRegistry);
        await engine1.run();
        const firstCount = warnSpy.mock.calls.filter(
          args => typeof args[0] === 'string' && args[0].includes('safetyCap')
        ).length;
        expect(firstCount).toBe(1);

        // Fresh instance — the in-memory `_warnedSafetyCaps` set wouldn't
        // help here. Storage-backed dedup must suppress the warning.
        const engine2 = new PlaybookEngine(capRunbook('cap-pb-1'), emptyRegistry);
        await engine2.run();
        const secondCount = warnSpy.mock.calls.filter(
          args => typeof args[0] === 'string' && args[0].includes('safetyCap')
        ).length;
        expect(secondCount).toBe(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    test('after 24h TTL elapses, a new run warns again', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const engine1 = new PlaybookEngine(capRunbook('cap-pb-2'), emptyRegistry);
        await engine1.run();
        expect(warnSpy.mock.calls.filter(
          a => typeof a[0] === 'string' && a[0].includes('safetyCap')
        ).length).toBe(1);

        // Simulate >24h passage by ageing the stored timestamp.
        const map = _engineLocalStore.get('meta.warnedSafetyCaps') || {};
        for (const k of Object.keys(map)) map[k] = Date.now() - (25 * 60 * 60 * 1000);
        _engineLocalStore.set('meta.warnedSafetyCaps', map);

        const engine2 = new PlaybookEngine(capRunbook('cap-pb-2'), emptyRegistry);
        await engine2.run();
        const finalCount = warnSpy.mock.calls.filter(
          a => typeof a[0] === 'string' && a[0].includes('safetyCap')
        ).length;
        expect(finalCount).toBe(2);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  // Bug 4 / Bug 21: every activity-log entry from a single run shares a
  // stable runId so the popup can dedupe checkpoints when summing daily counts.
  describe('runId on activity log entries (Bug 4 / Bug 21)', () => {
    test('final activity log entry includes a runId', async () => {
      const calls = [];
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        calls.push(message);
        callback({ success: true });
      });

      const playbook = makePlaybook([
        { action: 'setVar', var: 'processedCount', value: 1 }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();

      const finalEntry = calls.find(
        c => c.action === 'logActivity' && c.entry?.action === 'playbook_run'
      );
      expect(finalEntry).toBeDefined();
      expect(typeof finalEntry.entry.runId).toBe('string');
      expect(finalEntry.entry.runId.length).toBeGreaterThan(0);
    });

    test('checkpoints share the same runId as the final entry', async () => {
      const calls = [];
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        calls.push(message);
        callback({ success: true });
      });

      const playbook = makePlaybook([
        { action: 'setVar', var: 'i', value: 0 },
        {
          action: 'loop',
          breakIf: '$i >= 22',
          steps: [{ action: 'incrementVar', var: 'i' }]
        }
      ]);
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      await engine.run();

      const checkpoints = calls.filter(
        c => c.action === 'logActivity' && c.entry?.action === 'playbook_checkpoint'
      );
      const finalEntry = calls.find(
        c => c.action === 'logActivity' && c.entry?.action === 'playbook_run'
      );

      expect(checkpoints.length).toBeGreaterThanOrEqual(2);
      expect(finalEntry).toBeDefined();
      const sharedId = finalEntry.entry.runId;
      expect(typeof sharedId).toBe('string');
      for (const cp of checkpoints) {
        expect(cp.entry.runId).toBe(sharedId);
      }
    });

    test('two consecutive runs produce different runIds', async () => {
      const calls = [];
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        calls.push(message);
        callback({ success: true });
      });

      const playbook = makePlaybook([
        { action: 'setVar', var: 'x', value: 1 }
      ]);
      const engine1 = new PlaybookEngine(playbook, emptyRegistry);
      await engine1.run();
      const engine2 = new PlaybookEngine(playbook, emptyRegistry);
      await engine2.run();

      const finals = calls.filter(
        c => c.action === 'logActivity' && c.entry?.action === 'playbook_run'
      );
      expect(finals.length).toBe(2);
      expect(finals[0].entry.runId).not.toBe(finals[1].entry.runId);
    });
  });

  // Bug 22: runInteractive surfaces a per-cycle token-usage history on the
  // activity log entry so the popup can render a budget timeline.
  describe('runInteractive cycleHistory (Bug 22)', () => {
    let originalSendMessage;
    beforeEach(() => {
      originalSendMessage = chrome.runtime.sendMessage.getMockImplementation();
    });
    afterEach(() => {
      chrome.runtime.sendMessage.mockImplementation(originalSendMessage);
    });

    test('activity log entry includes cycleHistory with per-cycle tokensUsed', async () => {
      const calls = [];
      let cycle = 0;
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        calls.push(message);
        if (message.action === 'aiRequest') {
          cycle++;
          if (cycle >= 3) {
            callback({
              parsed: { done: true, summary: 'wrap' },
              usage: { prompt_tokens: 5, completion_tokens: 5 }
            });
          } else {
            callback({
              parsed: {
                reasoning: `cycle ${cycle} reasoning`,
                steps: [{ action: 'log', message: 'tick' }],
                done: false
              },
              usage: { prompt_tokens: 100 * cycle, completion_tokens: 0 }
            });
          }
        } else {
          callback({ success: true });
        }
      });

      const playbook = {
        id: 'cycle-history',
        version: 1,
        name: 'Cycle History',
        trustLevel: 'interactive',
        userRequest: 'check cycle history',
        steps: [],
        settings: { delayMs: 1, maxCycles: 5, maxTokensBudget: 100000 }
      };
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      const result = await engine.run();

      expect(Array.isArray(result.cycleHistory)).toBe(true);
      expect(result.cycleHistory.length).toBeGreaterThanOrEqual(3);
      expect(result.cycleHistory[0]).toEqual(expect.objectContaining({
        cycle: 1,
        tokensUsed: 100
      }));
      expect(result.cycleHistory[1]).toEqual(expect.objectContaining({
        cycle: 2,
        tokensUsed: 200
      }));

      const finalEntry = calls.find(
        c => c.action === 'logActivity' && c.entry?.action === 'playbook_run'
      );
      expect(finalEntry).toBeDefined();
      expect(Array.isArray(finalEntry.entry.cycleHistory)).toBe(true);
      expect(finalEntry.entry.cycleHistory.length).toBeGreaterThanOrEqual(3);
    });

    test('cycleHistory is capped at the last 20 entries', async () => {
      // Drive >20 cycles via budget exhaustion. The engine pushes a
      // cycleHistory entry per cycle BEFORE the budget check, so we let
      // it accumulate >20 entries, then breakIf budget exit. Result-shaping
      // caps cycleHistory at the last 20.
      let callCount = 0;
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        if (message.action === 'aiRequest') {
          callCount++;
          callback({
            parsed: {
              reasoning: `cycle ${callCount}`,
              steps: [{ action: 'log', message: 'tick' }],
              done: false
            },
            // Each cycle costs 5000 tokens. With 100k budget, cycle 21
            // pushes total to 105k and trips the budget exit AFTER the
            // cycleHistory.push for that cycle, giving us 21 entries.
            usage: { prompt_tokens: 5000, completion_tokens: 0 }
          });
        } else {
          callback({ success: true });
        }
      });

      const playbook = {
        id: 'cycle-cap',
        version: 1,
        name: 'Cycle Cap',
        trustLevel: 'interactive',
        userRequest: 'spin',
        steps: [],
        settings: { delayMs: 1, maxCycles: 50, maxTokensBudget: 100000 }
      };
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      const result = await engine.run();
      expect(callCount).toBeGreaterThan(20);
      expect(result.cycleHistory).toBeDefined();
      expect(result.cycleHistory.length).toBe(20);
    }, 30000);
  });

  describe('runInteractive summary fallback (Bug 16)', () => {
    let originalSendMessage;
    beforeEach(() => {
      originalSendMessage = chrome.runtime.sendMessage.getMockImplementation();
    });
    afterEach(() => {
      chrome.runtime.sendMessage.mockImplementation(originalSendMessage);
    });

    test('returns last reasoning when maxCycles exhausts without done', async () => {
      let cycle = 0;
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        if (message.action === 'aiRequest') {
          cycle++;
          callback({
            parsed: {
              reasoning: `cycle ${cycle} reasoning text`,
              steps: [{ action: 'log', message: 'hi' }],
              done: false
            },
            usage: { prompt_tokens: 1, completion_tokens: 1 }
          });
        } else {
          callback({ success: true });
        }
      });

      const playbook = {
        id: 'no-done',
        version: 1,
        name: 'Never Done',
        trustLevel: 'interactive',
        userRequest: 'loop forever',
        steps: [],
        settings: { delayMs: 1, maxCycles: 2 }
      };
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      const result = await engine.run();
      expect(result.summary).toBe('cycle 2 reasoning text');
      expect(result.exitReason).toBe('max_cycles');
    });

    test('exitReason is "done" when AI signals done', async () => {
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        if (message.action === 'aiRequest') {
          callback({
            parsed: { done: true, summary: 'all done' },
            usage: { prompt_tokens: 1, completion_tokens: 1 }
          });
        } else {
          callback({ success: true });
        }
      });
      const playbook = {
        id: 'done',
        version: 1,
        name: 'Done',
        trustLevel: 'interactive',
        userRequest: 'finish',
        steps: [],
        settings: { delayMs: 1, maxCycles: 5 }
      };
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      const result = await engine.run();
      expect(result.exitReason).toBe('done');
      expect(result.summary).toBe('all done');
    });

    test('exitReason is "budget" when token budget is exceeded', async () => {
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        if (message.action === 'aiRequest') {
          callback({
            parsed: {
              reasoning: 'still going',
              steps: [{ action: 'log', message: 'hi' }],
              done: false
            },
            usage: { prompt_tokens: 70000, completion_tokens: 0 }
          });
        } else {
          callback({ success: true });
        }
      });
      const playbook = {
        id: 'budget-exit',
        version: 1,
        name: 'Budget Exit',
        trustLevel: 'interactive',
        userRequest: 'spend tokens',
        steps: [],
        settings: { delayMs: 1, maxCycles: 5, maxTokensBudget: 60000 }
      };
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      const result = await engine.run();
      expect(result.exitReason).toBe('budget');
      expect(result.summary).toBeTruthy();
    });

    test('exitReason is "no_plan" when AI returns null parsed', async () => {
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        if (message.action === 'aiRequest') {
          callback({ parsed: null, usage: { prompt_tokens: 1, completion_tokens: 1 } });
        } else {
          callback({ success: true });
        }
      });
      const playbook = {
        id: 'no-plan',
        version: 1,
        name: 'No Plan',
        trustLevel: 'interactive',
        userRequest: 'fail',
        steps: [],
        settings: { delayMs: 1, maxCycles: 2 }
      };
      const engine = new PlaybookEngine(playbook, emptyRegistry);
      const result = await engine.run();
      expect(result.exitReason).toBe('no_plan');
      expect(result.summary).toBeTruthy();
    });
  });

  describe('classifyError (Bug 17)', () => {
    let originalSendMessage;
    beforeEach(() => {
      originalSendMessage = chrome.runtime.sendMessage.getMockImplementation();
    });
    afterEach(() => {
      chrome.runtime.sendMessage.mockImplementation(originalSendMessage);
    });

    test('classifies network/timeout messages as transient', () => {
      expect(classifyError('connection timeout')).toBe('transient');
      expect(classifyError('fetch failed')).toBe('transient');
      expect(classifyError('aborted')).toBe('transient');
      expect(classifyError('ECONNREFUSED')).toBe('transient');
      expect(classifyError('network error')).toBe('transient');
    });

    test('classifies auth errors as auth', () => {
      expect(classifyError('HTTP 401 Unauthorized')).toBe('auth');
      expect(classifyError('403 forbidden')).toBe('auth');
      expect(classifyError('Invalid API key')).toBe('auth');
    });

    test('classifies rate-limit errors as rate_limit', () => {
      expect(classifyError('429 Too Many Requests')).toBe('rate_limit');
      expect(classifyError('rate limit exceeded')).toBe('rate_limit');
    });

    test('returns null for empty/falsy input', () => {
      expect(classifyError(null)).toBeNull();
      expect(classifyError('')).toBeNull();
      expect(classifyError(undefined)).toBeNull();
    });

    test('falls back to unknown for unrecognized messages', () => {
      expect(classifyError('something weird happened')).toBe('unknown');
    });

    // Bug 9: classifyError previously missed common transient patterns
    // (DNS, ETIMEDOUT, socket resets) and tagged them "unknown".
    test('classifies expanded transient patterns', () => {
      expect(classifyError('ETIMEDOUT')).toBe('transient');
      expect(classifyError('connect EAI_AGAIN api.example.com')).toBe('transient');
      expect(classifyError('socket hang up')).toBe('transient');
      expect(classifyError('EHOSTUNREACH 1.2.3.4:443')).toBe('transient');
      expect(classifyError('ENETUNREACH')).toBe('transient');
      expect(classifyError('connection reset by peer')).toBe('transient');
      expect(classifyError('dns lookup failed')).toBe('transient');
    });

    test('classifies "unauthorized" wording as auth', () => {
      expect(classifyError('Request unauthorized')).toBe('auth');
    });

    test('classifies quota errors as rate_limit', () => {
      expect(classifyError('Quota exceeded for project')).toBe('rate_limit');
    });

    test('previousResults includes errorClass when a step throws mid-cycle', async () => {
      const { ACTION_REGISTRY } = require('../src/content/actions/index.js');
      const originalLog = ACTION_REGISTRY.log;
      let thrown = false;
      ACTION_REGISTRY.log = () => {
        if (!thrown) { thrown = true; throw new Error('fetch network timeout'); }
      };

      const inputs = [];
      chrome.runtime.sendMessage.mockImplementation((message, callback) => {
        if (message.action === 'aiRequest') {
          inputs.push(JSON.parse(message.input));
          if (inputs.length === 1) {
            callback({
              parsed: {
                reasoning: 'try logging',
                steps: [{ action: 'log', message: 'will throw' }],
                done: false
              },
              usage: { prompt_tokens: 1, completion_tokens: 1 }
            });
          } else {
            callback({
              parsed: { done: true, summary: 'gave up' },
              usage: { prompt_tokens: 1, completion_tokens: 1 }
            });
          }
        } else {
          callback({ success: true });
        }
      });

      try {
        const playbook = {
          id: 'classify',
          version: 1,
          name: 'Classify',
          trustLevel: 'interactive',
          userRequest: 'classify err',
          steps: [],
          settings: { delayMs: 1, maxCycles: 3 }
        };
        const engine = new PlaybookEngine(playbook, emptyRegistry);
        await engine.run();

        expect(inputs.length).toBeGreaterThanOrEqual(2);
        const cycle2 = inputs[1];
        expect(cycle2.previousResults).toBeTruthy();
        expect(cycle2.previousResults.error).toMatch(/network|timeout|fetch/i);
        expect(cycle2.previousResults.errorClass).toBe('transient');
      } finally {
        ACTION_REGISTRY.log = originalLog;
      }
    });
  });
});
