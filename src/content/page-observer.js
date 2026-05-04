/**
 * PageObserver — generates compact DOM snapshots for interactive AI mode.
 *
 * Produces a concise representation of the current page state that
 * can be sent to an LLM for reasoning, without blowing up token counts.
 */

import { isVisible } from '../shared/dom.js';

/**
 * Generate a snapshot of the current page state.
 * @returns {Object} Compact page representation
 */
export function snapshot() {
  const url = window.location?.href || '';

  return {
    url,
    pageType: detectPageType(url),
    title: document.title || '',
    sections: detectSections(),
    buttons: detectButtons(),
    modals: detectModals(),
    inputs: detectInputs(),
    textSummary: getTextSummary(),
    timestamp: new Date().toISOString()
  };
}

/**
 * Detect the LinkedIn page type from URL.
 * @param {string} url
 * @returns {string}
 */
function detectPageType(url) {
  if (url.includes('/in/')) return 'profile';
  if (url.includes('/mynetwork/invitation-manager')) return 'invitations';
  if (url.includes('/search/results/')) return 'search';
  if (url.includes('/messaging/')) return 'messaging';
  if (url.includes('/mynetwork/invite-connect/connections')) return 'connections';
  if (url.includes('/feed/')) return 'feed';
  if (url.includes('/jobs/')) return 'jobs';
  if (url.includes('/mynetwork/')) return 'network';
  return 'unknown';
}

/**
 * Detect major page sections (headings and landmark regions).
 * @returns {string[]}
 */
function detectSections() {
  const sections = [];

  // Section headings
  const headings = document.querySelectorAll(
    'h1, h2, ' +
    'section[id], ' +
    '[id="experience"], [id="experience-section"], ' +
    '[id="education"], [id="education-section"], ' +
    '[id="skills"], [id="skills-section"], ' +
    '[id="about"], [id="about-section"]'
  );
  for (const h of headings) {
    const text = h.textContent.trim().slice(0, 50);
    if (text && !sections.includes(text)) {
      sections.push(text);
    }
    if (sections.length >= 10) break;
  }

  return sections;
}

/**
 * Detect visible, interactive buttons.
 * @returns {string[]}
 */
function detectButtons() {
  const seen = new Set();
  const buttons = [];

  const elements = document.querySelectorAll('button, a[role="button"]');
  for (const el of elements) {
    if (!isVisible(el)) continue; // Not visible
    if (el.disabled) continue;
    if (el.closest('[aria-hidden="true"]')) continue;

    const text = el.textContent.trim().slice(0, 30);
    const label = el.getAttribute('aria-label') || '';
    const key = text || label;

    if (key && !seen.has(key) && !key.includes('li-bulk-')) {
      seen.add(key);
      buttons.push(key);
    }
    if (buttons.length >= 15) break;
  }

  return buttons;
}

/**
 * Detect any open modals.
 * @returns {Object[]}
 */
function detectModals() {
  const modals = [];
  const modalElements = document.querySelectorAll('[role="dialog"], .artdeco-modal');

  for (const modal of modalElements) {
    if (!isVisible(modal)) continue;
    const title = modal.querySelector('h2, h3, [class*="title"]');
    modals.push({
      title: title ? title.textContent.trim().slice(0, 50) : 'Modal',
      buttons: Array.from(modal.querySelectorAll('button'))
        .filter(isVisible)
        .map(b => b.textContent.trim().slice(0, 20))
        .filter(Boolean)
        .slice(0, 5)
    });
  }

  return modals;
}

/**
 * Detect visible input fields.
 * @returns {Object[]}
 */
function detectInputs() {
  const inputs = [];
  const elements = document.querySelectorAll('input, textarea, [contenteditable="true"]');

  for (const el of elements) {
    if (!isVisible(el)) continue;
    inputs.push({
      type: el.tagName.toLowerCase(),
      placeholder: el.placeholder || el.getAttribute('aria-label') || '',
      hasValue: !!(el.value || el.textContent.trim())
    });
    if (inputs.length >= 5) break;
  }

  return inputs;
}

/**
 * Get a concise text summary of the main page content.
 * @returns {string}
 */
function getTextSummary() {
  const main = document.querySelector('main') || document.body;
  const text = main.innerText || main.textContent || '';

  // Take first ~500 chars, cleaning up whitespace
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}
