/**
 * Tests for PlaybookEngine
 */
import { PlaybookEngine } from '../src/content/engine.js';

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
  beforeEach(() => {
    document.body.innerHTML = '';
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
});
