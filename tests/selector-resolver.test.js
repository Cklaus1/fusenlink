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

  // ── Bug 14 / Bug 17: linkedin.posts registry smoke test ─────────────────
  describe('linkedin.posts registry', () => {
    test('has version 2, 4 required keys, each with >=3 strategies', () => {
      const { DEFAULT_SELECTOR_REGISTRIES } = require('../src/defaults/selectors.js');
      const postsRegistry = DEFAULT_SELECTOR_REGISTRIES['linkedin.posts'];
      expect(postsRegistry).toBeDefined();
      // version bumped to 2 as part of Bug 14 fix
      expect(postsRegistry.version).toBe(2);

      const requiredKeys = ['commenterContainer', 'commenterName', 'commenterProfileLink', 'loadMoreComments'];
      for (const key of requiredKeys) {
        expect(postsRegistry[key]).toBeDefined();
        expect(postsRegistry[key].strategies.length).toBeGreaterThanOrEqual(3);
      }
    });

    test('loads without throwing and resolves commenterContainer key', () => {
      const { DEFAULT_SELECTOR_REGISTRIES } = require('../src/defaults/selectors.js');
      const postsRegistry = DEFAULT_SELECTOR_REGISTRIES['linkedin.posts'];

      // Instantiate a resolver with the real registry — must not throw
      const r = new SelectorResolver(postsRegistry);
      document.body.innerHTML = '<article class="comments-comment-item">Commenter</article>';
      const results = r.findAll('commenterContainer');
      // jsdom doesn't mock visibility so visible filter may drop it; just verify no throw
      expect(Array.isArray(results)).toBe(true);
      r.dispose();
    });
  });

  // ── Bug 25 + Bug 13: MutationObserver cache invalidation with debounce ───
  describe('_installCacheInvalidator / dispose', () => {
    test('dispose disconnects the observer without throwing', () => {
      const r = new SelectorResolver(testRegistry);
      expect(() => r.dispose()).not.toThrow();
      // Second dispose should be safe too
      expect(() => r.dispose()).not.toThrow();
    });

    test('cache is invalidated after debounce window when a child is added to body', async () => {
      jest.useFakeTimers();
      const r = new SelectorResolver(testRegistry);

      // Warm the cache by triggering a shadow-root lookup
      r._getKnownShadowRoots();
      expect(r._shadowRootCache).not.toBeNull();
      expect(r._shadowRootCacheTime).toBeGreaterThan(0);

      // Mutate document.body — schedules debounce timer
      const div = document.createElement('div');
      document.body.appendChild(div);

      // Yield microtask queue so MutationObserver callback fires and schedules timer
      await Promise.resolve();

      // Cache must NOT be cleared yet (debounce timer still pending)
      expect(r._shadowRootCache).not.toBeNull();

      // Advance timers past the 250ms debounce window
      jest.advanceTimersByTime(300);

      // Now the cache should be cleared
      expect(r._shadowRootCache).toBeNull();
      expect(r._shadowRootCacheTime).toBe(0);

      r.dispose();
      jest.useRealTimers();
    });

    test('dispose clears any pending debounce timer', async () => {
      jest.useFakeTimers();
      const r = new SelectorResolver(testRegistry);

      // Trigger a mutation to arm the debounce
      document.body.appendChild(document.createElement('span'));
      await Promise.resolve(); // let observer callback fire

      // Timer is pending — dispose should clear it without calling invalidateCache
      const invalidateSpy = jest.spyOn(r, 'invalidateCache');
      r.dispose();
      jest.advanceTimersByTime(500);

      // invalidateCache must NOT have been called after dispose
      expect(invalidateSpy).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    test('100 rapid mutations call invalidateCache at most ~5 times in 1 second', async () => {
      jest.useFakeTimers();
      const r = new SelectorResolver(testRegistry);
      const invalidateSpy = jest.spyOn(r, 'invalidateCache');

      // Fire 100 mutations spread over 1000ms in 10ms increments
      for (let i = 0; i < 100; i++) {
        document.body.appendChild(document.createElement('div'));
        await Promise.resolve(); // flush observer microtask
        jest.advanceTimersByTime(10); // 10ms between each mutation
      }
      // Advance past final debounce window
      jest.advanceTimersByTime(300);

      // With 250ms debounce and 10ms between mutations, the timer keeps getting
      // replaced by the leading-edge guard. In 1000ms we expect far fewer than
      // 100 calls — at most a handful.
      expect(invalidateSpy.mock.calls.length).toBeLessThanOrEqual(5);
      expect(invalidateSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

      r.dispose();
      jest.useRealTimers();
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

  // ── v4: sectionByHeading strategy ────────────────────────────────────────
  describe('sectionByHeading strategy', () => {
    test('returns the section element when no `child` is set', () => {
      document.body.innerHTML = `
        <main>
          <section><h2>About</h2><div class="about-body">about content</div></section>
          <section><h2>Experience</h2><div class="exp-body">exp content</div></section>
        </main>
      `;
      const reg = {
        about: {
          strategies: [{ type: 'sectionByHeading', text: 'About' }]
        }
      };
      const r = new SelectorResolver(reg);
      const results = r.findAll('about');
      expect(results).toHaveLength(1);
      expect(results[0].tagName).toBe('SECTION');
      expect(results[0].querySelector('h2').textContent).toBe('About');
    });

    test('returns the matching child when `child` is set', () => {
      document.body.innerHTML = `
        <main>
          <section><h2>About</h2><div class="about-body">about content</div></section>
        </main>
      `;
      const reg = {
        aboutBody: {
          strategies: [{ type: 'sectionByHeading', text: 'About', child: 'div' }]
        }
      };
      const r = new SelectorResolver(reg);
      const results = r.findAll('aboutBody');
      expect(results).toHaveLength(1);
      expect(results[0].className).toBe('about-body');
    });

    test('matches by case-insensitive substring (so "Skills (50)" matches "Skills")', () => {
      document.body.innerHTML = `
        <main>
          <section><h2>Skills (50)</h2><div class="skills-body">skill list</div></section>
        </main>
      `;
      const reg = {
        skills: {
          strategies: [{ type: 'sectionByHeading', text: 'Skills', child: 'div' }]
        }
      };
      const r = new SelectorResolver(reg);
      const results = r.findAll('skills');
      expect(results).toHaveLength(1);
      expect(results[0].className).toBe('skills-body');
    });

    test('returns empty when no heading matches', () => {
      document.body.innerHTML = `
        <main>
          <section><h2>About</h2><div>x</div></section>
        </main>
      `;
      const reg = {
        skills: {
          strategies: [{ type: 'sectionByHeading', text: 'Skills', child: 'div' }]
        }
      };
      const r = new SelectorResolver(reg);
      expect(r.findAll('skills')).toEqual([]);
    });
  });

  // ── v4: walkFromAnchor strategy ──────────────────────────────────────────
  describe('walkFromAnchor strategy', () => {
    test('walks from anchor to parent then resolves a child selector', () => {
      document.body.innerHTML = `
        <main>
          <h1>Name</h1>
          <p>Headline</p>
          <p class="loc">Location</p>
        </main>
      `;
      // Note: anchor is h1 — its parent is <main>. Inside <main>, p:nth-of-type(2)
      // is the second <p> (Location).
      const reg = {
        loc: {
          strategies: [{
            type: 'walkFromAnchor',
            anchorSelector: 'main h1',
            relative: 'parent',
            then: 'p:nth-of-type(2)'
          }]
        }
      };
      const r = new SelectorResolver(reg);
      const results = r.findAll('loc');
      expect(results).toHaveLength(1);
      expect(results[0].textContent).toBe('Location');
    });

    test('relative: closest-section returns the enclosing section', () => {
      document.body.innerHTML = `
        <section>
          <h2>Hello</h2>
          <p>p1</p>
          <p>p2</p>
        </section>
      `;
      const reg = {
        target: {
          strategies: [{
            type: 'walkFromAnchor',
            anchorSelector: 'h2',
            relative: 'closest-section',
            then: 'p:nth-of-type(2)'
          }]
        }
      };
      const r = new SelectorResolver(reg);
      const results = r.findAll('target');
      expect(results).toHaveLength(1);
      expect(results[0].textContent).toBe('p2');
    });

    test('relative: closest-listitem walks up to the listitem and resolves a child p', () => {
      // The connections-page case: anchor is an /in/ link; we want to find the
      // headline p living as a sibling of that anchor inside the listitem.
      document.body.innerHTML = `
        <ul>
          <li role="listitem">
            <a href="/in/foo"><span>Name</span></a>
            <p>Engineer at Foo</p>
          </li>
        </ul>
      `;
      const reg = {
        headline: {
          strategies: [{
            type: 'walkFromAnchor',
            anchorSelector: 'a[href*="/in/"]',
            relative: 'closest-listitem',
            then: 'p'
          }]
        }
      };
      const r = new SelectorResolver(reg);
      const results = r.findAll('headline');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].textContent).toBe('Engineer at Foo');
    });

    test('anchorText filters anchors by case-insensitive substring', () => {
      document.body.innerHTML = `
        <div><span class="a">connect now</span><p class="next">connect target</p></div>
        <div><span class="a">other</span><p class="next">other target</p></div>
      `;
      const reg = {
        target: {
          strategies: [{
            type: 'walkFromAnchor',
            anchorSelector: 'span.a',
            anchorText: 'connect',
            relative: 'parent',
            then: 'p.next'
          }]
        }
      };
      const r = new SelectorResolver(reg);
      const results = r.findAll('target');
      expect(results).toHaveLength(1);
      expect(results[0].textContent).toBe('connect target');
    });

    test('thenIndex picks the Nth match across all descendants', () => {
      // Each <p> lives in its own DIV — :nth-of-type can't reach across the cluster,
      // so we use thenIndex to index into querySelectorAll-style results.
      document.body.innerHTML = `
        <section>
          <h2>Name</h2>
          <div><p>headline</p><p>edu-line</p></div>
          <div><p>location</p></div>
        </section>
      `;
      const reg = {
        loc: {
          strategies: [{
            type: 'walkFromAnchor',
            anchorSelector: 'h2',
            firstAnchorOnly: true,
            relative: 'closest-section',
            then: 'p',
            thenIndex: 2
          }]
        }
      };
      const r = new SelectorResolver(reg);
      const results = r.findAll('loc');
      expect(results).toHaveLength(1);
      expect(results[0].textContent).toBe('location');
    });

    test('firstAnchorOnly stops after the first matching anchor', () => {
      document.body.innerHTML = `
        <section><h2>One</h2><p>p1</p></section>
        <section><h2>Two</h2><p>p2</p></section>
      `;
      const reg = {
        target: {
          strategies: [{
            type: 'walkFromAnchor',
            anchorSelector: 'h2',
            firstAnchorOnly: true,
            relative: 'closest-section',
            then: 'p'
          }]
        }
      };
      const r = new SelectorResolver(reg);
      const results = r.findAll('target');
      expect(results).toHaveLength(1);
      expect(results[0].textContent).toBe('p1');
    });

    test('returns empty array when anchor not found (no throw)', () => {
      document.body.innerHTML = `<div>nothing</div>`;
      const reg = {
        target: {
          strategies: [{
            type: 'walkFromAnchor',
            anchorSelector: 'main h1',
            relative: 'parent',
            then: 'p'
          }]
        }
      };
      const r = new SelectorResolver(reg);
      expect(r.findAll('target')).toEqual([]);
    });
  });

  // ── v4: registry version bumps + new top-of-list strategies ──────────────
  describe('v4 registry — version bumps and walk/heading strategies', () => {
    test('rotted registries report their current versions', () => {
      const { DEFAULT_SELECTOR_REGISTRIES } = require('../src/defaults/selectors.js');
      expect(DEFAULT_SELECTOR_REGISTRIES['linkedin.profile'].version).toBe(5);
      expect(DEFAULT_SELECTOR_REGISTRIES['linkedin.feed'].version).toBe(4);
      expect(DEFAULT_SELECTOR_REGISTRIES['linkedin.connections'].version).toBe(5);
      expect(DEFAULT_SELECTOR_REGISTRIES['linkedin.search'].version).toBe(4);
    });

    test('linkedin.profile.profileAbout has sectionByHeading at the top', () => {
      const { DEFAULT_SELECTOR_REGISTRIES } = require('../src/defaults/selectors.js');
      const entry = DEFAULT_SELECTOR_REGISTRIES['linkedin.profile'].profileAbout;
      expect(entry.strategies[0].type).toBe('sectionByHeading');
      expect(entry.strategies[0].text.toLowerCase()).toBe('about');
      expect(entry.strategies[0].child).toBe('div');
    });

    test('linkedin.profile.profileLocation has walkFromAnchor at the top', () => {
      const { DEFAULT_SELECTOR_REGISTRIES } = require('../src/defaults/selectors.js');
      const entry = DEFAULT_SELECTOR_REGISTRIES['linkedin.profile'].profileLocation;
      expect(entry.strategies[0].type).toBe('walkFromAnchor');
      expect(entry.strategies[0].anchorSelector).toContain('h2');
    });

    test('linkedin.profile modal-only keys carry scope: modal', () => {
      const { DEFAULT_SELECTOR_REGISTRIES } = require('../src/defaults/selectors.js');
      const reg = DEFAULT_SELECTOR_REGISTRIES['linkedin.profile'];
      expect(reg.addNoteButton.scope).toBe('modal');
      expect(reg.noteTextarea.scope).toBe('modal');
      expect(reg.sendConnectButton.scope).toBe('modal');
    });

    test('linkedin.connections.connectionHeadline has walkFromAnchor at the top', () => {
      const { DEFAULT_SELECTOR_REGISTRIES } = require('../src/defaults/selectors.js');
      const entry = DEFAULT_SELECTOR_REGISTRIES['linkedin.connections'].connectionHeadline;
      expect(entry.strategies[0].type).toBe('walkFromAnchor');
      // 2026 lite UI dropped the [role="listitem"] wrapper, so the walk now
      // climbs to the /in/ link's parent rather than its closest listitem.
      expect(entry.strategies[0].relative).toBe('parent');
    });

    test('linkedin.feed.postComposer carries scope: modal', () => {
      const { DEFAULT_SELECTOR_REGISTRIES } = require('../src/defaults/selectors.js');
      expect(DEFAULT_SELECTOR_REGISTRIES['linkedin.feed'].postComposer.scope).toBe('modal');
      expect(DEFAULT_SELECTOR_REGISTRIES['linkedin.feed'].postSubmitButton.scope).toBe('modal');
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
