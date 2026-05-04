/**
 * Shared DOM helpers used by both content-script modules.
 */

/**
 * Determine if an element is visually rendered.
 *
 * Tries computed style first (catches display:none, visibility:hidden, opacity:0
 * regardless of position), then layout rect (correctly handles position:fixed
 * elements whose offsetParent is null). Falls back to offsetParent for jsdom
 * and other layout-less environments.
 *
 * @param {Element|null} el
 * @returns {boolean}
 */
export function isVisible(el) {
  if (!el) return false;

  const cs = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
  if (cs && cs.display) {
    if (cs.display === 'none') return false;
    if (cs.visibility === 'hidden') return false;
    if (cs.opacity === '0') return false;
  }

  const rect = el.getBoundingClientRect();
  if (rect.width !== 0 || rect.height !== 0) return true;

  // Layout unavailable (jsdom) — coarse fallback.
  return el.offsetParent !== null;
}
