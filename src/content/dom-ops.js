/**
 * DOM Operations — low-level DOM manipulation for the PlaybookEngine.
 *
 * Fixes:
 *   Bug #1: querySelectorAllDeep replaced with SelectorResolver scoped queries
 *   Bug #2: Modal operations scoped to modal containers only
 *   Bug #5: goToNextPage URL fallback removed (SPA-safe only)
 *   Bug #7: Security check enabled consistently
 *   Bug #8: "More" buttons verified before use
 */

import { SECURITY_MESSAGES } from '../shared/constants.js';

/**
 * Create a promise that resolves after a delay.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Click an element. Skips detached/stale elements.
 * @param {HTMLElement} element
 * @returns {boolean} True if click was executed
 */
export function click(element) {
  if (!element || !document.contains(element)) return false;
  // Native element.click() only dispatches a 'click' event. React-driven
  // dropdown menu items (e.g. LinkedIn's overflow LI items) often listen
  // for the full pointer/mouse sequence via root delegation; without
  // mousedown+mouseup the menu stays open and the action no-ops.
  // Dispatch a full sequence with realistic coords so React intercepts.
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
  try {
    element.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse' }));
  } catch { /* PointerEvent unsupported in some envs — skip */ }
  element.dispatchEvent(new MouseEvent('mousedown', opts));
  try {
    element.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse' }));
  } catch { /* skip */ }
  element.dispatchEvent(new MouseEvent('mouseup', opts));
  // Final click — also fires the handler bound directly via element.onclick
  // or via the native click() path. Fall back to element.click() if
  // dispatchEvent didn't produce a click (some elements are special).
  const dispatched = element.dispatchEvent(new MouseEvent('click', opts));
  if (dispatched && typeof element.click === 'function') {
    // dispatchEvent fired but for completeness also call the native click
    // so anchors / submit buttons still navigate. No double-fire risk for
    // React handlers because they listen on synthetic events at the root.
    try { element.click(); } catch { /* ignore */ }
  }
  return true;
}

/**
 * Scroll the page.
 * @param {string} direction - 'top' or 'bottom'
 */
export function scroll(direction) {
  if (direction === 'top') {
    window.scrollTo(0, 0);
  } else {
    window.scrollTo(0, document.body.scrollHeight);
  }
}

/**
 * Scroll an element into view.
 * @param {HTMLElement} element
 */
export function scrollIntoView(element) {
  if (element) {
    element.scrollIntoView({ behavior: 'instant', block: 'center' });
  }
}

/**
 * Wait for new elements matching a selector key to appear after a count baseline.
 * @param {import('./selector-resolver.js').SelectorResolver} resolver
 * @param {string} selectorKey
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=8]
 * @param {number} [options.intervalMs=300]
 * @param {string} [options.fallbackKey]
 * @returns {Promise<boolean>} True if new elements appeared
 */
export async function waitForNew(resolver, selectorKey, options = {}) {
  const { maxAttempts = 8, intervalMs = 300, fallbackKey } = options;
  const countBefore = resolver.count(selectorKey, fallbackKey);

  for (let i = 0; i < maxAttempts; i++) {
    await delay(intervalMs);
    const current = resolver.count(selectorKey, fallbackKey);
    if (current > countBefore) return true;
  }

  return false;
}

/**
 * Wait for at least one element matching a selector key to appear.
 * @param {import('./selector-resolver.js').SelectorResolver} resolver
 * @param {string} selectorKey
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=15]
 * @param {number} [options.intervalMs=500]
 * @returns {Promise<boolean>}
 */
export async function waitForElement(resolver, selectorKey, options = {}) {
  const { maxAttempts = 15, intervalMs = 500 } = options;

  for (let i = 0; i < maxAttempts; i++) {
    const el = resolver.findOne(selectorKey);
    if (el) return true;
    await delay(intervalMs);
  }

  return false;
}

/**
 * Dismiss any visible modal by finding and clicking dismiss/close buttons.
 * Uses scoped queries (modal scope) to avoid clicking page-level buttons.
 * @param {import('./selector-resolver.js').SelectorResolver} resolver
 * @returns {Promise<void>}
 */
export async function dismissModal(resolver) {
  await delay(200);
  const btn = resolver.findOne('dismissButton', { scope: 'modal' });
  if (btn) {
    click(btn);
    await delay(300);

    // Verify the modal actually closed
    const stillOpen = resolver.findOne('dismissButton', { scope: 'modal' });
    if (stillOpen) {
      // Try Escape key as fallback
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await delay(200);
    }
  }
}

/**
 * Handle the Send Invitation modal after clicking Connect.
 * Scoped to modal containers to prevent re-clicking page-level Connect buttons.
 *
 * Fixes bug #2: all queries scoped to modal, preventing infinite click loops.
 *
 * @param {import('./selector-resolver.js').SelectorResolver} resolver
 * @returns {Promise<boolean>} True if invitation was sent
 */
export async function handleInviteModal(resolver) {
  await delay(400);

  // Try "Send without a note" / "Send" / "Send now" (all in modal scope)
  const sendBtn = resolver.findOne('sendButton', { scope: 'modal' });
  if (sendBtn) {
    click(sendBtn);
    await delay(200);
    return true;
  }

  // Try Connect button inside modal (not on the page)
  const connectBtn = resolver.findOne('connectInModal', { scope: 'modal' });
  if (connectBtn) {
    click(connectBtn);
    await delay(200);
    return true;
  }

  // No actionable button found — dismiss the modal
  await dismissModal(resolver);
  return false;
}

/**
 * Close any open dropdown menu.
 */
export function dismissDropdown() {
  // Try clicking outside
  document.body.click();
  // Escape key as backup
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

/**
 * Navigate to the next page of results (SPA-safe only).
 * Fixes bug #5: URL fallback removed entirely.
 *
 * @param {import('./selector-resolver.js').SelectorResolver} resolver
 * @returns {Promise<boolean>} True if next page button was found and clicked
 */
export async function navigateNext(resolver) {
  // Scroll to bottom so pagination is visible
  scroll('bottom');
  await delay(500);

  const nextBtn = resolver.findOne('nextPageButton');
  if (nextBtn) {
    scrollIntoView(nextBtn);
    await delay(150);
    click(nextBtn);
    return true;
  }

  return false;
}

/**
 * Check for security challenges (CAPTCHA, rate limiting).
 * Fixes bug #7: consistently enabled for all workflows via playbook settings.
 *
 * @param {import('./selector-resolver.js').SelectorResolver} resolver
 * @param {Object} engineContext - Engine context for stop/status
 * @param {Function} engineContext.updateStatus
 * @param {Function} engineContext.updateProgress
 * @param {Function} engineContext.isStopRequested
 * @param {number} engineContext.processedCount
 * @param {number} engineContext.totalCount
 * @param {number} engineContext.startTime
 * @returns {Promise<boolean>} True if a challenge was detected (and either resolved or timed out)
 */
export async function checkSecurity(resolver, engineContext) {
  // Check for CAPTCHA iframe
  const captcha = resolver.findOne('securityChallenge');

  // Check for security messages in appropriate containers
  const securityMsg = resolver.findOne('securityMessage');

  if (!captcha && !securityMsg) return false;

  // Challenge detected — pause and wait
  const matchedText = securityMsg ? findMatchingSecurityText(securityMsg) : 'CAPTCHA';
  engineContext.updateStatus(`Paused \u2013 resolve security challenge to continue (${matchedText})`);

  const maxWaitMs = 5 * 60 * 1000;
  const checkIntervalMs = 1000;
  const maxAttempts = maxWaitMs / checkIntervalMs;
  let attempts = 0;

  while (attempts < maxAttempts && !engineContext.isStopRequested()) {
    await delay(checkIntervalMs);
    attempts++;

    // Re-check
    const stillCaptcha = resolver.findOne('securityChallenge');
    const stillMsg = resolver.findOne('securityMessage');

    if (!stillCaptcha && !stillMsg) {
      engineContext.updateStatus('Security challenge resolved, resuming...');
      await delay(1000);
      return true;
    }

    if (attempts % 5 === 0) {
      const waitMin = Math.floor(attempts / 60);
      engineContext.updateStatus(`Waiting for security challenge (${waitMin}m)`);
    }
  }

  if (!engineContext.isStopRequested()) {
    engineContext.updateStatus('Timed out waiting for security challenge');
    // Signal stop so the engine doesn't re-enter this 5-minute wait loop
    if (engineContext.requestStop) engineContext.requestStop();
  }
  return true;
}

/**
 * Find which security message text matched.
 * @param {HTMLElement} element
 * @returns {string}
 */
function findMatchingSecurityText(element) {
  const text = element.textContent.toLowerCase();
  return SECURITY_MESSAGES.find(msg => text.includes(msg)) || 'security issue';
}

/**
 * Verify that a "More" dropdown button actually contains a Connect option.
 * Fixes bug #8: prevents clicking "More" buttons that don't have Connect.
 *
 * @param {HTMLElement} moreButton - The "More" button to verify
 * @param {import('./selector-resolver.js').SelectorResolver} resolver
 * @param {string} verificationKey - Selector key to look for in the dropdown
 * @returns {Promise<boolean>} True if the verification key is found in the dropdown
 */
export async function verifyDropdownContains(moreButton, resolver, verificationKey) {
  if (!click(moreButton)) return false;
  await delay(200);

  const option = resolver.findOne(verificationKey, { scope: 'dropdown' });

  if (!option) {
    dismissDropdown();
    await delay(100);
    return false;
  }

  // Close dropdown — the engine will re-open it when processing
  dismissDropdown();
  await delay(100);
  return true;
}
