/**
 * Tests for SelectorResolver
 */
import { SelectorResolver } from '../src/content/selector-resolver.js';

// Mock registry for testing
const testRegistry = {
  simpleButton: {
    strategies: [
      { type: 'css', value: '.action-btn' }
    ]
  },
  acceptButton: {
    strategies: [
      { type: 'cssWithText', value: 'button.invite-action', text: 'Accept' },
      { type: 'textExact', value: 'button', text: 'Accept' }
    ],
    filters: ['visible', 'enabled', 'notAriaHidden']
  },
  ariaButton: {
    strategies: [
      { type: 'ariaLabel', value: 'button', pattern: 'accept.*invitation' }
    ]
  },
  textMatchButton: {
    strategies: [
      { type: 'textMatch', value: 'button', text: 'More' }
    ],
    filters: ['visible']
  },
  modalDismiss: {
    strategies: [
      { type: 'css', value: 'button[aria-label="Dismiss"]' }
    ],
    scope: 'modal'
  },
  securityMessage: {
    strategies: [
      { type: 'css', value: '[role="alert"]' }
    ],
    textPatterns: ['security check', 'too many requests']
  },
  cardCount: {
    strategies: [
      { type: 'css', value: '.card' }
    ]
  },
  cardCountByButtons: {
    strategies: [
      { type: 'css', value: '.card-btn' }
    ],
    countDivisor: 2
  }
};

describe('SelectorResolver', () => {
  let resolver;

  beforeEach(() => {
    document.body.innerHTML = '';
    resolver = new SelectorResolver(testRegistry);
  });

  describe('findAll', () => {
    test('resolves css strategy', () => {
      document.body.innerHTML = `
        <button class="action-btn">Click</button>
        <button class="action-btn">Other</button>
      `;
      const results = resolver.findAll('simpleButton');
      expect(results).toHaveLength(2);
    });

    test('returns empty array for unknown key', () => {
      const results = resolver.findAll('nonexistent');
      expect(results).toEqual([]);
    });

    test('resolves cssWithText strategy', () => {
      document.body.innerHTML = `
        <button class="invite-action">Accept</button>
        <button class="invite-action">Ignore</button>
      `;
      const results = resolver.findAll('acceptButton');
      expect(results).toHaveLength(1);
      expect(results[0].textContent).toBe('Accept');
    });

    test('falls back to second strategy when first fails', () => {
      document.body.innerHTML = `
        <button>Accept</button>
        <button>Ignore</button>
      `;
      // First strategy (cssWithText on .invite-action) will find nothing
      // Second strategy (textExact on button) should match
      const results = resolver.findAll('acceptButton');
      expect(results).toHaveLength(1);
      expect(results[0].textContent).toBe('Accept');
    });

    test('resolves ariaLabel strategy', () => {
      document.body.innerHTML = `
        <button aria-label="Accept invitation from John">Accept</button>
        <button aria-label="Ignore invitation from John">Ignore</button>
      `;
      const results = resolver.findAll('ariaButton');
      expect(results).toHaveLength(1);
    });

    test('resolves textMatch strategy', () => {
      document.body.innerHTML = `
        <button>More actions</button>
        <button>Connect</button>
      `;
      const results = resolver.findAll('textMatchButton');
      expect(results).toHaveLength(1);
      expect(results[0].textContent).toBe('More actions');
    });

    test('text override works', () => {
      document.body.innerHTML = `
        <button class="invite-action">Ignore</button>
        <button class="invite-action">Accept</button>
      `;
      // Override text to find Ignore instead of Accept
      const results = resolver.findAll('acceptButton', { text: 'Ignore' });
      expect(results).toHaveLength(1);
      expect(results[0].textContent).toBe('Ignore');
    });
  });

  describe('filters', () => {
    test('filters out disabled buttons', () => {
      document.body.innerHTML = `
        <button class="invite-action" disabled>Accept</button>
      `;
      const results = resolver.findAll('acceptButton');
      expect(results).toHaveLength(0);
    });

    test('filters out aria-hidden elements', () => {
      document.body.innerHTML = `
        <div aria-hidden="true">
          <button class="invite-action">Accept</button>
        </div>
      `;
      const results = resolver.findAll('acceptButton');
      expect(results).toHaveLength(0);
    });
  });

  describe('findOne', () => {
    test('returns first matching element', () => {
      document.body.innerHTML = `
        <button class="action-btn">First</button>
        <button class="action-btn">Second</button>
      `;
      const result = resolver.findOne('simpleButton');
      expect(result).not.toBeNull();
      expect(result.textContent).toBe('First');
    });

    test('returns null when nothing matches', () => {
      document.body.innerHTML = '<div>Nothing here</div>';
      const result = resolver.findOne('simpleButton');
      expect(result).toBeNull();
    });
  });

  describe('count', () => {
    test('counts matching elements', () => {
      document.body.innerHTML = `
        <div class="card">1</div>
        <div class="card">2</div>
        <div class="card">3</div>
      `;
      expect(resolver.count('cardCount')).toBe(3);
    });

    test('applies countDivisor', () => {
      document.body.innerHTML = `
        <button class="card-btn">Accept</button>
        <button class="card-btn">Ignore</button>
        <button class="card-btn">Accept</button>
        <button class="card-btn">Ignore</button>
      `;
      expect(resolver.count('cardCountByButtons')).toBe(2);
    });

    test('uses fallback key when primary returns 0', () => {
      document.body.innerHTML = `
        <button class="card-btn">Accept</button>
        <button class="card-btn">Ignore</button>
      `;
      // cardCount (looks for .card) returns 0, fallback to cardCountByButtons
      expect(resolver.count('cardCount', 'cardCountByButtons')).toBe(1);
    });
  });

  describe('textPatterns filter', () => {
    test('filters by text patterns', () => {
      document.body.innerHTML = `
        <div role="alert">There was a security check required</div>
        <div role="alert">Normal alert message</div>
      `;
      const results = resolver.findAll('securityMessage');
      expect(results).toHaveLength(1);
      expect(results[0].textContent).toContain('security check');
    });

    test('returns empty when no text pattern matches', () => {
      document.body.innerHTML = `
        <div role="alert">Everything is fine</div>
      `;
      const results = resolver.findAll('securityMessage');
      expect(results).toHaveLength(0);
    });
  });

  describe('scope', () => {
    test('modal scope queries dialog containers', () => {
      document.body.innerHTML = `
        <button aria-label="Dismiss">Page dismiss</button>
        <div role="dialog">
          <button aria-label="Dismiss">Modal dismiss</button>
        </div>
      `;
      const results = resolver.findAll('modalDismiss');
      // Should find the one inside the dialog
      expect(results).toHaveLength(1);
      expect(results[0].closest('[role="dialog"]')).not.toBeNull();
    });
  });

  describe('setRegistry', () => {
    test('updates the registry', () => {
      document.body.innerHTML = '<button class="new-btn">Click</button>';
      resolver.setRegistry({
        simpleButton: {
          strategies: [{ type: 'css', value: '.new-btn' }]
        }
      });
      const results = resolver.findAll('simpleButton');
      expect(results).toHaveLength(1);
    });
  });

  // ── Bug 1: visible filter ────────────────────────────────────────────────
  describe('visible filter — position:fixed elements', () => {
    test('passes an element styled position:fixed with non-zero dimensions', () => {
      document.body.innerHTML = `<button class="fixed-btn">Toast</button>`;
      const btn = document.body.querySelector('.fixed-btn');

      // jsdom's getBoundingClientRect returns all-zeros by default; mock it so
      // the element appears to have real dimensions (simulating a rendered fixed element).
      btn.getBoundingClientRect = () => ({ width: 200, height: 40, top: 0, left: 0, bottom: 40, right: 200 });

      // offsetParent is null in jsdom for fixed elements — the old code would
      // have filtered this out; the new code should keep it.
      Object.defineProperty(btn, 'offsetParent', { value: null, configurable: true });

      const reg = {
        fixedEl: {
          strategies: [{ type: 'css', value: '.fixed-btn' }],
          filters: ['visible']
        }
      };
      const r = new SelectorResolver(reg);
      const results = r.findAll('fixedEl');
      expect(results).toHaveLength(1);
    });

    test('filters out an element with display:none', () => {
      document.body.innerHTML = `<button class="hidden-btn" style="display:none">Hidden</button>`;
      const btn = document.body.querySelector('.hidden-btn');

      // Zero dimensions — the rect guard also catches this, but let's be explicit
      btn.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 });

      const reg = {
        hiddenEl: {
          strategies: [{ type: 'css', value: '.hidden-btn' }],
          filters: ['visible']
        }
      };
      const r = new SelectorResolver(reg);
      const results = r.findAll('hiddenEl');
      expect(results).toHaveLength(0);
    });
  });

  // ── Bug 2: textPatterns per-strategy short-circuit ───────────────────────
  describe('textPatterns — falls through to next strategy when none match', () => {
    test('uses strategy 2 when strategy 1 elements all fail textPatterns', () => {
      // Strategy 1 finds .wrong-class buttons — their text won't match the pattern.
      // Strategy 2 finds .right-class buttons — their text WILL match.
      document.body.innerHTML = `
        <button class="wrong-class">Nope</button>
        <button class="wrong-class">Also nope</button>
        <button class="right-class">security check required</button>
      `;

      const reg = {
        securityAlert: {
          strategies: [
            { type: 'css', value: '.wrong-class' },
            { type: 'css', value: '.right-class' }
          ],
          textPatterns: ['security check']
        }
      };
      const r = new SelectorResolver(reg);
      const results = r.findAll('securityAlert');
      // Must be the element from strategy 2, not empty
      expect(results).toHaveLength(1);
      expect(results[0].textContent).toContain('security check');
    });
  });

  // ── Bug 17: linkedin.posts registry smoke test ───────────────────────────
  describe('linkedin.posts registry', () => {
    test('loads without throwing and resolves commenterContainer key', () => {
      const { DEFAULT_SELECTOR_REGISTRIES } = require('../src/defaults/selectors.js');
      const postsRegistry = DEFAULT_SELECTOR_REGISTRIES['linkedin.posts'];
      expect(postsRegistry).toBeDefined();
      expect(postsRegistry.version).toBe(1);
      expect(postsRegistry.commenterContainer).toBeDefined();
      expect(postsRegistry.commenterName).toBeDefined();
      expect(postsRegistry.commenterProfileLink).toBeDefined();
      expect(postsRegistry.loadMoreComments).toBeDefined();

      // Instantiate a resolver with the real registry — must not throw
      const r = new SelectorResolver(postsRegistry);
      document.body.innerHTML = '<article class="comments-comment-item">Commenter</article>';
      const results = r.findAll('commenterContainer');
      // jsdom doesn't mock visibility so visible filter may drop it; just verify no throw
      expect(Array.isArray(results)).toBe(true);
      r.dispose();
    });
  });

  // ── Bug 25: MutationObserver cache invalidation ──────────────────────────
  describe('_installCacheInvalidator / dispose', () => {
    test('dispose disconnects the observer without throwing', () => {
      const r = new SelectorResolver(testRegistry);
      expect(() => r.dispose()).not.toThrow();
      // Second dispose should be safe too
      expect(() => r.dispose()).not.toThrow();
    });

    test('cache is invalidated when a direct child is added to document.body', async () => {
      const r = new SelectorResolver(testRegistry);

      // Warm the cache by triggering a shadow-root lookup
      r._getKnownShadowRoots();
      expect(r._shadowRootCache).not.toBeNull();
      expect(r._shadowRootCacheTime).toBeGreaterThan(0);

      // Mutate document.body — the observer should fire synchronously in jsdom
      const div = document.createElement('div');
      document.body.appendChild(div);

      // MutationObserver callbacks in jsdom fire asynchronously (microtask).
      // Yield to the microtask queue so the callback runs.
      await Promise.resolve();

      expect(r._shadowRootCache).toBeNull();
      expect(r._shadowRootCacheTime).toBe(0);

      r.dispose();
    });

    test('setRegistry does NOT install a second observer', () => {
      const r = new SelectorResolver(testRegistry);
      const originalObserver = r._mutationObserver;
      r.setRegistry(testRegistry);
      // The observer reference must be the same object — setRegistry must not replace it
      expect(r._mutationObserver).toBe(originalObserver);
      r.dispose();
    });
  });

  // ── Bug 3: bad selector warns once, doesn't throw ────────────────────────
  describe('_executeStrategy — bad selector logs once and does not throw', () => {
    test('does not throw for an invalid CSS selector', () => {
      const reg = {
        badSel: {
          strategies: [{ type: 'css', value: '<<<not-valid>>>' }]
        }
      };
      const r = new SelectorResolver(reg);
      expect(() => r.findAll('badSel')).not.toThrow();
      expect(r.findAll('badSel')).toEqual([]);
    });

    test('emits console.warn exactly once for repeated bad-selector calls', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const reg = {
        badSel: {
          strategies: [{ type: 'css', value: '<<<not-valid>>>' }]
        }
      };
      const r = new SelectorResolver(reg);

      r.findAll('badSel');
      r.findAll('badSel');
      r.findAll('badSel');

      // Should only have warned about the bad strategy once (plus one for unknown key? no).
      // Filter to only the "strategy failed" warnings.
      const strategyWarns = warnSpy.mock.calls.filter(args =>
        String(args[0]).includes('strategy failed')
      );
      expect(strategyWarns).toHaveLength(1);

      warnSpy.mockRestore();
    });

    test('resets warning suppression after setRegistry', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const reg = {
        badSel: {
          strategies: [{ type: 'css', value: '<<<not-valid>>>' }]
        }
      };
      const r = new SelectorResolver(reg);

      r.findAll('badSel'); // first call — warns once

      // Replace registry (same bad selector) — should warn again
      r.setRegistry(reg);
      r.findAll('badSel'); // warn again for the fresh registry

      const strategyWarns = warnSpy.mock.calls.filter(args =>
        String(args[0]).includes('strategy failed')
      );
      expect(strategyWarns).toHaveLength(2);

      warnSpy.mockRestore();
    });
  });
});
