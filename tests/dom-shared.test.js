/**
 * Unit tests for src/shared/dom.js — isVisible helper.
 *
 * jsdom does not run a full layout engine, so getBoundingClientRect always
 * returns a zero rect. isVisible therefore falls through to the offsetParent
 * fallback. setup.js mocks offsetParent to return parentNode, which is:
 *   - non-null for elements appended to document.body  → visible
 *   - null     for detached elements                    → not visible
 *
 * Computed-style tests stub window.getComputedStyle inline so they don't
 * pollute one another.
 */
import { isVisible } from '../src/shared/dom.js';

describe('isVisible', () => {
  const originalGetComputedStyle = window.getComputedStyle;

  afterEach(() => {
    // Restore after each test so stubs don't bleed into later tests.
    Object.defineProperty(window, 'getComputedStyle', {
      value: originalGetComputedStyle,
      configurable: true,
      writable: true
    });
  });

  test('returns false for null', () => {
    expect(isVisible(null)).toBe(false);
  });

  test('returns false for element with display:none', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    Object.defineProperty(window, 'getComputedStyle', {
      value: () => ({ display: 'none', visibility: 'visible', opacity: '1' }),
      configurable: true,
      writable: true
    });
    expect(isVisible(el)).toBe(false);
    document.body.removeChild(el);
  });

  test('returns false for element with visibility:hidden', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    Object.defineProperty(window, 'getComputedStyle', {
      value: () => ({ display: 'block', visibility: 'hidden', opacity: '1' }),
      configurable: true,
      writable: true
    });
    expect(isVisible(el)).toBe(false);
    document.body.removeChild(el);
  });

  test('returns false for element with opacity:0', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    Object.defineProperty(window, 'getComputedStyle', {
      value: () => ({ display: 'block', visibility: 'visible', opacity: '0' }),
      configurable: true,
      writable: true
    });
    expect(isVisible(el)).toBe(false);
    document.body.removeChild(el);
  });

  test('returns true for normal attached element (offsetParent fallback)', () => {
    // Stub a "normal" computed style so computed-style checks all pass.
    Object.defineProperty(window, 'getComputedStyle', {
      value: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
      configurable: true,
      writable: true
    });
    const el = document.createElement('div');
    document.body.appendChild(el);
    // jsdom returns zero rects — falls through to offsetParent.
    // setup.js mocks offsetParent as parentNode; attached el has parentNode → truthy.
    expect(isVisible(el)).toBe(true);
    document.body.removeChild(el);
  });

  test('returns false for detached element (offsetParent null)', () => {
    Object.defineProperty(window, 'getComputedStyle', {
      value: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
      configurable: true,
      writable: true
    });
    const el = document.createElement('div');
    // Not appended anywhere — parentNode is null → offsetParent mock returns null.
    expect(isVisible(el)).toBe(false);
  });
});
