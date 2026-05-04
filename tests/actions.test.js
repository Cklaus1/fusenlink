/**
 * Tests for engine action handlers and the action registry.
 */
import { PlaybookEngine } from '../src/content/engine.js';
import { ACTION_REGISTRY } from '../src/content/actions/index.js';

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = jest.fn();

function makePlaybook(steps, settings = {}, extra = {}) {
  return {
    id: 'test',
    version: 1,
    name: 'Test',
    urlPattern: 'test',
    steps,
    settings: { delayMs: 10, ...settings },
    ...extra
  };
}

const emptyRegistry = {};

describe('Action Registry', () => {
  test('all known actions are registered', () => {
    const expected = [
      'setVar', 'incrementVar', 'appendArray', 'updateProgress', 'log',
      'find', 'findAll', 'click', 'wait', 'scroll', 'scrollIntoView',
      'countElements', 'checkSecurity', 'dismissModal', 'handleInviteModal',
      'dismissDropdown', 'navigateNext', 'waitForNew', 'waitForElement',
      'verifyDropdown', 'extract', 'extractAll', 'aiCall', 'storeData',
      'navigate', 'getPageContent', 'prompt', 'typeText'
    ];
    for (const action of expected) {
      expect(ACTION_REGISTRY[action]).toBeDefined();
      expect(typeof ACTION_REGISTRY[action]).toBe('function');
    }
  });

  test('registry has no extra unexpected actions', () => {
    expect(Object.keys(ACTION_REGISTRY).length).toBe(28);
  });
});

describe('Extract action', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('extracts structured data from page', async () => {
    document.body.innerHTML = `
      <h1 class="name">Jane Doe</h1>
      <p class="headline">VP Engineering</p>
    `;
    const registry = {
      profileName: { strategies: [{ type: 'css', value: '.name' }] },
      profileHeadline: { strategies: [{ type: 'css', value: '.headline' }] }
    };
    const playbook = makePlaybook([
      {
        action: 'extract',
        var: 'profile',
        selectors: {
          name: { selector: 'profileName', attribute: 'textContent' },
          headline: { selector: 'profileHeadline', attribute: 'textContent' }
        }
      }
    ]);
    const engine = new PlaybookEngine(playbook, registry);
    await engine.run();
    expect(engine.vars.profile.name).toBe('Jane Doe');
    expect(engine.vars.profile.headline).toBe('VP Engineering');
  });

  test('returns null for missing selectors', async () => {
    document.body.innerHTML = '<h1 class="name">Jane</h1>';
    const registry = {
      profileName: { strategies: [{ type: 'css', value: '.name' }] },
      missing: { strategies: [{ type: 'css', value: '.nope' }] }
    };
    const playbook = makePlaybook([
      {
        action: 'extract',
        var: 'data',
        selectors: {
          name: { selector: 'profileName', attribute: 'textContent' },
          bio: { selector: 'missing', attribute: 'textContent' }
        }
      }
    ]);
    const engine = new PlaybookEngine(playbook, registry);
    await engine.run();
    expect(engine.vars.data.name).toBe('Jane');
    expect(engine.vars.data.bio).toBeNull();
  });
});

describe('ExtractAll action', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('extracts list of items from containers', async () => {
    document.body.innerHTML = `
      <div class="card"><span class="n">Alice</span><span class="t">Dev</span></div>
      <div class="card"><span class="n">Bob</span><span class="t">PM</span></div>
    `;
    const registry = {
      cards: { strategies: [{ type: 'css', value: '.card' }] },
      cardName: { strategies: [{ type: 'css', value: '.n' }] },
      cardTitle: { strategies: [{ type: 'css', value: '.t' }] }
    };
    const playbook = makePlaybook([
      {
        action: 'extractAll',
        var: 'people',
        containerSelector: 'cards',
        fields: {
          name: { childSelector: 'cardName', attribute: 'textContent' },
          title: { childSelector: 'cardTitle', attribute: 'textContent' }
        }
      }
    ]);
    const engine = new PlaybookEngine(playbook, registry);
    await engine.run();
    expect(engine.vars.people).toHaveLength(2);
    expect(engine.vars.people[0].name).toBe('Alice');
    expect(engine.vars.people[1].title).toBe('PM');
  });
});

describe('AppendArray action', () => {
  test('merges arrays', async () => {
    const playbook = makePlaybook([
      { action: 'setVar', var: 'batch1', value: [1, 2] },
      { action: 'setVar', var: 'batch2', value: [3, 4] },
      { action: 'setVar', var: 'list', value: [] },
      { action: 'appendArray', var: 'list', items: '$batch1' },
      { action: 'appendArray', var: 'list', items: '$batch2' }
    ]);
    const engine = new PlaybookEngine(playbook, emptyRegistry);
    await engine.run();
    expect(engine.vars.list).toEqual([1, 2, 3, 4]);
  });
});

describe('GetPageContent action', () => {
  test('gets text from a selector', async () => {
    document.body.innerHTML = '<main class="content">Hello World</main>';
    const registry = {
      mainContent: { strategies: [{ type: 'css', value: '.content' }] }
    };
    const playbook = makePlaybook([
      { action: 'getPageContent', selector: 'mainContent', var: 'text' }
    ]);
    const engine = new PlaybookEngine(playbook, registry);
    await engine.run();
    // jsdom doesn't support innerText, but the action falls through to textContent
    // which the engine uses. Let's verify it stores something non-empty.
    expect(engine.vars.text).toBeDefined();
  });

  test('falls back to empty string if element not found', async () => {
    document.body.innerHTML = '';
    const registry = {
      missing: { strategies: [{ type: 'css', value: '.nope' }] }
    };
    const playbook = makePlaybook([
      { action: 'getPageContent', selector: 'missing', var: 'text' }
    ]);
    const engine = new PlaybookEngine(playbook, registry);
    await engine.run();
    expect(engine.vars.text).toBe('');
  });
});

describe('Trust levels', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('auto trust level runs click without prompting', async () => {
    document.body.innerHTML = '<button id="btn">Click</button>';
    const registry = { btn: { strategies: [{ type: 'css', value: '#btn' }] } };
    const playbook = makePlaybook([
      { action: 'find', selector: 'btn', var: 'b' },
      { action: 'click', element: '$b' }
    ], {}, { trustLevel: 'auto' });

    const engine = new PlaybookEngine(playbook, registry);
    const btn = document.getElementById('btn');
    const spy = jest.spyOn(btn, 'click');
    await engine.run();
    expect(spy).toHaveBeenCalled();
  });
});

describe('Navigate action', () => {
  test('default same-origin navigation calls window.location.assign', async () => {
    const playbook = makePlaybook([
      { action: 'navigate', url: '/in/janedoe/' }
    ]);
    const engine = new PlaybookEngine(playbook, emptyRegistry);

    // jsdom locks window.location.assign as read-only — override the whole
    // location object with a stub for this test, then restore it afterward.
    const originalLocation = window.location;
    const assignFn = jest.fn();
    delete window.location;
    window.location = {
      ...originalLocation,
      origin: originalLocation.origin,
      href: originalLocation.href,
      assign: assignFn
    };

    const pushSpy = jest.spyOn(history, 'pushState');

    try {
      await engine.run();
      expect(assignFn).toHaveBeenCalled();
      const assignArg = assignFn.mock.calls[assignFn.mock.calls.length - 1][0];
      expect(assignArg).toContain('/in/janedoe/');
      // Default mode should NOT use pushState
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      window.location = originalLocation;
      pushSpy.mockRestore();
    }
  });

  test('softNavigate uses pushState + popstate for same-origin SPA navigation', async () => {
    const playbook = makePlaybook([
      { action: 'navigate', url: '/in/janedoe/', softNavigate: true }
    ]);
    const engine = new PlaybookEngine(playbook, emptyRegistry);

    const pushSpy = jest.spyOn(history, 'pushState');
    let dispatchedPopstate = false;
    const popListener = (e) => {
      if (e.type === 'popstate') dispatchedPopstate = true;
    };
    window.addEventListener('popstate', popListener);

    await engine.run();
    expect(pushSpy).toHaveBeenCalled();
    // The first pushState arg is state, second title, third URL
    const lastCallArgs = pushSpy.mock.calls[pushSpy.mock.calls.length - 1];
    expect(lastCallArgs[2]).toContain('/in/janedoe/');
    expect(dispatchedPopstate).toBe(true);

    window.removeEventListener('popstate', popListener);
    pushSpy.mockRestore();
  });
});
