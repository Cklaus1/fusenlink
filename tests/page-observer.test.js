/**
 * Smoke tests for page-observer.js
 */

import { snapshot } from '../src/content/page-observer';

describe('PageObserver', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('isVisible returns true for visible elements (via snapshot buttons)', () => {
    const el = document.createElement('button');
    el.textContent = 'Click';
    document.body.appendChild(el);
    // jsdom has no layout engine — offsetParent fallback applies.
    // The button is appended to body so offsetParent !== null.
    const snap = snapshot();
    expect(snap.buttons).toContain('Click');
  });

  test('isVisible filters display:none elements (via snapshot buttons)', () => {
    const el = document.createElement('button');
    el.textContent = 'Hidden';
    el.style.display = 'none';
    document.body.appendChild(el);
    // jsdom's getComputedStyle reflects inline styles, so display:none is caught.
    const snap = snapshot();
    expect(snap.buttons).not.toContain('Hidden');
  });

  test('snapshot returns expected shape', () => {
    const snap = snapshot();
    expect(snap).toHaveProperty('url');
    expect(snap).toHaveProperty('pageType');
    expect(snap).toHaveProperty('sections');
    expect(snap).toHaveProperty('buttons');
    expect(snap).toHaveProperty('modals');
    expect(snap).toHaveProperty('inputs');
    expect(snap).toHaveProperty('textSummary');
    expect(snap).toHaveProperty('timestamp');
  });

  test('detectSections ignores broad id substring matches', () => {
    // An element with id="about-this-author" should NOT be picked up
    const div = document.createElement('div');
    div.id = 'about-this-author';
    div.textContent = 'Should not appear';
    document.body.appendChild(div);
    const snap = snapshot();
    expect(snap.sections).not.toContain('Should not appear');
  });

  test('detectSections picks up exact id="about"', () => {
    const section = document.createElement('section');
    section.id = 'about';
    section.textContent = 'About section content';
    document.body.appendChild(section);
    const snap = snapshot();
    // The section itself is picked up via section[id] or [id="about"]
    expect(snap.sections.some(s => s.includes('About section'))).toBe(true);
  });
});
