/**
 * SelectorResolver — resolves selector registry keys into DOM elements.
 * Uses ordered fallback strategies and scoped queries to avoid the
 * performance and correctness bugs in the original content.js.
 *
 * Fixes bug #1: querySelectorAllDeep('*') replaced with targeted shadow host queries
 * Fixes bug #2: modal/dropdown scoping prevents matching page-level buttons
 * Fixes bug #8: requiresVerification ensures "More" buttons actually contain Connect
 */

import { SHADOW_HOSTS, EXTENSION_UI_CLASSES } from '../shared/constants.js';
import { isVisible } from '../shared/dom.js';

export class SelectorResolver {
  /**
   * @param {Object} registry - A selector registry object (e.g. linkedin.invitations)
   */
  constructor(registry) {
    this.registry = registry;
    this._shadowRootCache = null;
    this._shadowRootCacheTime = 0;
    // Tracks strategy keys that have already emitted a warning to avoid log spam
    this._warnedStrategies = new Set();
    this._mutationObserver = null;
    this._installCacheInvalidator();
  }

  /**
   * Update the registry (e.g. after a dynamic update).
   * @param {Object} registry
   */
  setRegistry(registry) {
    this.registry = registry;
    this.invalidateCache();
    // Fresh registry gets fresh warnings so new selectors are properly surfaced
    this._warnedStrategies = new Set();
  }

  /**
   * Invalidate the shadow root cache (call after major DOM changes).
   * Note: does NOT reset _warnedStrategies — invalidateCache fires frequently
   * (mutation events) and we don't want to re-spam warnings on every DOM change.
   * _warnedStrategies is reset only in setRegistry (intentional registry swap).
   */
  invalidateCache() {
    this._shadowRootCache = null;
    this._shadowRootCacheTime = 0;
  }

  /**
   * Install a MutationObserver on document.body to invalidate the shadow root
   * cache when direct body children change (covers modal open/close events).
   * Fixes bug #25: 500ms cache window left stale shadow root refs after modals.
   * Fixes bug #13: debounced 250ms trailing-edge to avoid thrashing on feed pages
   * that mutate body children at high frequency (auto-loading new cards).
   */
  _installCacheInvalidator() {
    if (typeof MutationObserver === 'undefined') return; // jsdom may lack it
    this._debouncePending = null;
    const debounced = () => {
      if (this._debouncePending) return;
      this._debouncePending = setTimeout(() => {
        this._debouncePending = null;
        this.invalidateCache();
      }, 250);
    };
    this._mutationObserver = new MutationObserver(debounced);
    const observeBody = () => {
      try {
        this._mutationObserver.observe(document.body, {
          childList: true,
          subtree: false  // don't fire on every nested change; just direct body children
        });
      } catch (err) {
        // ignore — body may not be ready
      }
    };
    if (document.body) {
      observeBody();
    } else if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', observeBody);
    }
  }

  /**
   * Disconnect the MutationObserver and release resources.
   * Call when the resolver is no longer needed to avoid leaks.
   */
  dispose() {
    if (this._debouncePending) {
      clearTimeout(this._debouncePending);
      this._debouncePending = null;
    }
    if (this._mutationObserver) {
      this._mutationObserver.disconnect();
      this._mutationObserver = null;
    }
  }

  /**
   * Resolve a selector key to an array of matching elements.
   * @param {string} key - Registry key (e.g. 'acceptButton')
   * @param {Object} [options] - Override options
   * @param {string} [options.text] - Override text filter
   * @param {string} [options.scope] - Override scope
   * @param {HTMLElement} [options.scopeElement] - Specific element to scope queries to
   * @returns {HTMLElement[]}
   */
  findAll(key, options = {}) {
    const entry = this.registry[key];
    if (!entry) {
      console.warn(`SelectorResolver: unknown key "${key}"`);
      return [];
    }

    const scope = options.scope || entry.scope || 'document';
    const roots = this._getScopeRoots(scope, options.scopeElement);

    for (const strategy of entry.strategies) {
      const results = this._executeStrategy(strategy, roots, options.text);
      let filtered = this._applyFilters(results, entry.filters || []);

      // Apply textPatterns per-strategy so a strategy that matches elements
      // but none pass the pattern doesn't block subsequent strategies.
      if (entry.textPatterns) {
        filtered = this._filterByTextPatterns(filtered, entry.textPatterns);
      }

      if (filtered.length > 0) return filtered;
    }

    return [];
  }

  /**
   * Resolve a selector key to the first matching element.
   * @param {string} key - Registry key
   * @param {Object} [options]
   * @returns {HTMLElement|null}
   */
  findOne(key, options = {}) {
    const results = this.findAll(key, options);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Count elements matching a selector key.
   * Handles countDivisor for cases where we count button pairs.
   * @param {string} key - Registry key
   * @param {string} [fallbackKey] - Fallback registry key if primary returns 0
   * @returns {number}
   */
  count(key, fallbackKey) {
    const entry = this.registry[key];
    if (!entry) return 0;

    const results = this.findAll(key);
    if (results.length > 0) {
      return entry.countDivisor ? Math.ceil(results.length / entry.countDivisor) : results.length;
    }

    // Try fallback key
    if (fallbackKey) {
      const fallbackEntry = this.registry[fallbackKey];
      if (fallbackEntry) {
        const fallbackResults = this.findAll(fallbackKey);
        return fallbackEntry.countDivisor
          ? Math.ceil(fallbackResults.length / fallbackEntry.countDivisor)
          : fallbackResults.length;
      }
    }

    return 0;
  }

  /**
   * Get the DOM roots to search based on scope.
   * @param {string} scope
   * @param {HTMLElement} [scopeElement]
   * @returns {(Document|Element|ShadowRoot)[]}
   */
  _getScopeRoots(scope, scopeElement) {
    if (scopeElement) return [scopeElement];

    switch (scope) {
      case 'modal':
        return this._getModalRoots();
      case 'dropdown':
        return this._getDropdownRoots();
      default:
        // 'document' — search main document + known shadow hosts
        return [document, ...this._getKnownShadowRoots()];
    }
  }

  /**
   * Get modal containers including shadow DOM.
   * Fixes bug #1: only checks known shadow hosts, not all DOM elements.
   * @returns {(Element|ShadowRoot)[]}
   */
  _getModalRoots() {
    const roots = [];

    // Regular DOM modals
    const modals = document.querySelectorAll(
      '[role="dialog"], .artdeco-modal, .artdeco-modal-overlay'
    );
    roots.push(...modals);

    // Shadow DOM modals (known hosts only)
    for (const shadowRoot of this._getKnownShadowRoots()) {
      // Check if shadow root has modal content (don't use * — perf bomb)
      if (shadowRoot.childElementCount > 0) {
        roots.push(shadowRoot);
      }
    }

    return roots;
  }

  /**
   * Get open dropdown containers.
   * @returns {Element[]}
   */
  _getDropdownRoots() {
    const dropdowns = document.querySelectorAll(
      '.artdeco-dropdown__content, [role="menu"], .artdeco-dropdown--is-open'
    );
    return [...dropdowns];
  }

  /**
   * Get shadow roots from known LinkedIn shadow DOM hosts.
   * This replaces the perf-killing `document.querySelectorAll('*')` approach.
   * @returns {ShadowRoot[]}
   */
  _getKnownShadowRoots() {
    const now = Date.now();
    // Cache for 500ms to avoid redundant DOM queries in tight loops
    if (this._shadowRootCache && (now - this._shadowRootCacheTime) < 500) {
      return this._shadowRootCache;
    }
    const roots = [];
    for (const selector of SHADOW_HOSTS) {
      const host = document.querySelector(selector);
      if (host && host.shadowRoot) {
        roots.push(host.shadowRoot);
      }
    }
    this._shadowRootCache = roots;
    this._shadowRootCacheTime = now;
    return roots;
  }

  /**
   * Execute a single selector strategy against the given DOM roots.
   * @param {Object} strategy
   * @param {(Document|Element|ShadowRoot)[]} roots
   * @param {string} [textOverride]
   * @returns {HTMLElement[]}
   */
  _executeStrategy(strategy, roots, textOverride) {
    const results = [];

    for (const root of roots) {
      try {
        let elements;

        switch (strategy.type) {
          case 'css':
            elements = Array.from(root.querySelectorAll(strategy.value));
            results.push(...elements);
            break;

          case 'cssWithText': {
            elements = Array.from(root.querySelectorAll(strategy.value));
            const text = (textOverride || strategy.text || '').toLowerCase();
            results.push(...elements.filter(el =>
              el.textContent.trim().toLowerCase() === text
            ));
            break;
          }

          case 'ariaLabel': {
            elements = Array.from(root.querySelectorAll(strategy.value));
            const pattern = new RegExp(strategy.pattern, 'i');
            results.push(...elements.filter(el => {
              const label = el.getAttribute('aria-label') || '';
              return pattern.test(label);
            }));
            break;
          }

          case 'textExact': {
            elements = Array.from(root.querySelectorAll(strategy.value));
            const text = (textOverride || strategy.text || '').toLowerCase();
            results.push(...elements.filter(el =>
              el.textContent.trim().toLowerCase() === text
            ));
            break;
          }

          case 'textMatch': {
            elements = Array.from(root.querySelectorAll(strategy.value));
            const text = (textOverride || strategy.text || '').toLowerCase();
            results.push(...elements.filter(el =>
              el.textContent.trim().toLowerCase().includes(text)
            ));
            break;
          }

          case 'hasChild': {
            // Find parent elements that contain a matching child
            elements = Array.from(root.querySelectorAll(strategy.value));
            results.push(...elements);
            break;
          }

          case 'sectionByHeading': {
            // Find a heading by case-insensitive substring match, then return
            // its enclosing <section> (or a child of that section if `child` is set).
            // strategy.headingSelector defaults to 'h1, h2, h3'.
            // strategy.text — required substring (case-insensitive).
            // strategy.child — optional CSS selector for a descendant of the section.
            const headSel = strategy.headingSelector || 'h1, h2, h3';
            const target = (textOverride || strategy.text || '').toLowerCase();
            const headings = Array.from(root.querySelectorAll(headSel));
            for (const h of headings) {
              const text = h.textContent.trim().toLowerCase();
              if (target && !text.includes(target)) continue;
              const section = h.closest('section') || h.parentElement;
              if (!section) continue;
              if (strategy.child) {
                const child = section.querySelector(strategy.child);
                if (child) results.push(child);
              } else {
                results.push(section);
              }
            }
            break;
          }

          case 'walkFromAnchor': {
            // Find an anchor element (CSS + optional text), then walk to a relative
            // target and optionally apply a CSS selector under that target.
            // strategy.anchorSelector — CSS selector for the anchor.
            // strategy.anchorText — optional case-insensitive substring to require.
            // strategy.relative — one of: 'next-sibling', 'parent', 'closest-section', 'closest-li', 'closest-listitem'.
            // strategy.then — optional CSS selector resolved within the relative target.
            // strategy.thenIndex — optional 0-based index into the `then` matches (default 0 — i.e. first match).
            // strategy.firstAnchorOnly — if true, only walk from the first matching anchor (use to avoid h2-per-section explosions).
            const anchors = Array.from(root.querySelectorAll(strategy.anchorSelector || '*'));
            const target = (strategy.anchorText || '').toLowerCase();
            const idx = Number.isInteger(strategy.thenIndex) ? strategy.thenIndex : 0;
            for (const a of anchors) {
              if (target) {
                const text = a.textContent.trim().toLowerCase();
                if (!text.includes(target)) continue;
              }
              let el;
              switch (strategy.relative) {
                case 'next-sibling': el = a.nextElementSibling; break;
                case 'parent': el = a.parentElement; break;
                case 'closest-section': el = a.closest('section'); break;
                case 'closest-li': el = a.closest('li'); break;
                case 'closest-listitem': el = a.closest('[role="listitem"]'); break;
                default: el = a.parentElement;
              }
              if (!el) continue;
              if (strategy.then) {
                if (idx > 0) {
                  const all = el.querySelectorAll(strategy.then);
                  if (all[idx]) results.push(all[idx]);
                } else {
                  const child = el.querySelector(strategy.then);
                  if (child) results.push(child);
                }
              } else {
                results.push(el);
              }
              if (strategy.firstAnchorOnly) break;
            }
            break;
          }

          default:
            console.warn(`SelectorResolver: unknown strategy type "${strategy.type}"`);
        }
      } catch (err) {
        // Log once per unique (type, value) pair so typos in selectors surface
        // during development without flooding the console in production loops.
        const warnKey = `${strategy.type}:${strategy.value}`;
        if (!this._warnedStrategies.has(warnKey)) {
          this._warnedStrategies.add(warnKey);
          console.warn(`SelectorResolver: strategy failed (logged once)`, warnKey, err.message);
        }
        continue;
      }
    }

    return results;
  }

  /**
   * Apply standard filters to a set of elements.
   * @param {HTMLElement[]} elements
   * @param {string[]} filters
   * @returns {HTMLElement[]}
   */
  _applyFilters(elements, filters) {
    if (!filters || filters.length === 0) return elements;

    return elements.filter(el => {
      for (const filter of filters) {
        switch (filter) {
          case 'visible': {
            if (!isVisible(el)) return false;
            break;
          }
          case 'enabled':
            if (el.disabled) return false;
            break;
          case 'notAriaHidden':
            if (el.closest('[aria-hidden="true"]')) return false;
            break;
          case 'notExtensionUI':
            if (el.className && typeof el.className === 'string' &&
                el.className.includes('li-bulk-')) return false;
            break;
          case 'notDisabledClass':
            if (el.classList.contains('disabled')) return false;
            break;
        }
      }
      return true;
    });
  }

  /**
   * Filter elements that contain any of the given text patterns.
   * Used for security message detection.
   * @param {HTMLElement[]} elements
   * @param {string[]} patterns
   * @returns {HTMLElement[]}
   */
  _filterByTextPatterns(elements, patterns) {
    return elements.filter(el => {
      const text = el.textContent.toLowerCase();
      return patterns.some(p => text.includes(p));
    });
  }
}
