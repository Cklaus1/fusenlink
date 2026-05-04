/**
 * AI & data extraction engine actions.
 */
import * as DomOps from '../dom-ops.js';
import { sendMessage } from '../../shared/storage.js';
import { MSG } from '../../shared/messages.js';
import { showPrompt } from '../../ui/ai-panel.js';

export function extract(step, engine) {
  const data = {};
  const selectors = step.selectors || {};
  const scopeEl = step.scopeElement ? engine._resolve(step.scopeElement) : null;

  for (const [fieldName, fieldDef] of Object.entries(selectors)) {
    const opts = scopeEl ? { scopeElement: scopeEl } : {};
    if (fieldDef.multiple) {
      const elements = engine.resolver.findAll(fieldDef.selector, opts);
      data[fieldName] = elements.map(el => engine._extractAttribute(el, fieldDef.attribute));
    } else {
      const el = engine.resolver.findOne(fieldDef.selector, opts);
      data[fieldName] = el ? engine._extractAttribute(el, fieldDef.attribute) : null;
    }
  }

  if (step.var) engine.vars[step.var] = data;
}

export function extractAll(step, engine) {
  const containers = engine.resolver.findAll(step.containerSelector);
  const items = [];

  for (const container of containers) {
    const item = {};
    for (const [fieldName, fieldDef] of Object.entries(step.fields || {})) {
      // Bug 10: support multi-value fields. Without this, multi-valued
      // LinkedIn data (e.g., a list of skills/positions per card) collapses
      // to the first match per field.
      if (fieldDef.multiple) {
        const els = engine.resolver.findAll(fieldDef.childSelector, { scopeElement: container });
        if (fieldDef.attribute === 'exists') {
          item[fieldName] = els.map(() => true);
        } else {
          item[fieldName] = els.map(el => engine._extractAttribute(el, fieldDef.attribute));
        }
      } else {
        const el = engine.resolver.findOne(fieldDef.childSelector, { scopeElement: container });
        if (fieldDef.attribute === 'exists') {
          item[fieldName] = el !== null;
        } else {
          item[fieldName] = el ? engine._extractAttribute(el, fieldDef.attribute) : null;
        }
      }
    }
    items.push(item);
  }

  if (step.var) engine.vars[step.var] = items;
}

export async function aiCall(step, engine, Overlay) {
  Overlay.updateStatus('Thinking...');
  const input = engine._resolve(step.input);
  const response = await sendMessage({
    action: MSG.AI_REQUEST,
    aiType: step.aiType,
    input,
    systemPrompt: step.systemPrompt,
    userContext: engine._resolve(step.userContext)
  });

  if (response?.error) {
    const isConnectionError = response.error.includes('ECONNREFUSED') ||
                              response.error.includes('abort') ||
                              response.error.includes('fetch');
    const hint = isConnectionError
      ? 'AI provider unreachable. Check Settings > AI Configuration.'
      : `AI error: ${response.error}`;
    Overlay.updateStatus(hint);
    console.error('aiCall error:', response.error);
    if (step.var) engine.vars[step.var] = { error: response.error };
    // Bug 35: by default, propagate the error so downstream steps don't
    // operate on the {error: ...} sentinel. Opt out with breakOnError: false.
    if (step.breakOnError !== false) {
      throw new Error(`aiCall failed: ${response.error}`);
    }
  } else if (step.var) {
    engine.vars[step.var] = response?.parsed || response?.content || response;
  }
}

export async function storeData(step, engine) {
  const data = engine._resolve(step.data);
  await sendMessage({
    action: MSG.STORE_DATA,
    collection: step.collection,
    data,
    options: { mergeKey: step.mergeKey }
  });
}

export async function navigate(step, engine) {
  const url = engine._resolve(step.url);
  if (!url) return;

  const targetUrl = new URL(url, window.location.origin);
  const isSameOrigin = targetUrl.origin === window.location.origin;
  const newPath = targetUrl.pathname + targetUrl.search + targetUrl.hash;

  if (!isSameOrigin) {
    await sendMessage({ action: 'openTab', url: targetUrl.href });
    return;
  }

  // Default: hard navigation (correct, may flash). Opt in to softNavigate
  // for a SPA-style transition; falls back to hard nav if the page doesn't
  // actually move.
  if (step.softNavigate) {
    const beforeHref = window.location.href;
    try {
      history.pushState({}, '', newPath);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    } catch {
      window.location.assign(newPath);
      return;
    }
    if (step.waitFor) {
      await DomOps.delay(2000);
      const found = await DomOps.waitForElement(engine.resolver, step.waitFor, {
        maxAttempts: 20,
        intervalMs: 500
      });
      if (!found && window.location.href === beforeHref) {
        window.location.assign(newPath);
      }
    }
  } else {
    window.location.assign(newPath);
    if (step.waitFor) {
      // Hard nav reloads the page; the engine context dies. waitFor is moot
      // unless softNavigate is set. Document this with a warning if both
      // are present without softNavigate.
      console.warn('navigate: waitFor was set but softNavigate is false; the page will reload before waitFor can run');
    }
  }
}

export function getPageContent(step, engine) {
  const el = step.selector
    ? engine.resolver.findOne(step.selector)
    : document.body;
  if (step.var) {
    // innerText is preferred (layout-aware) but textContent as fallback (jsdom compat)
    engine.vars[step.var] = el ? (el.innerText || el.textContent || '').trim() : '';
  }
}

export async function prompt(step, engine) {
  const title = engine._resolve(step.title) || step.title || 'Confirm';
  const body = engine._resolve(step.body) || step.body || '';
  const options = step.options || ['OK', 'Cancel'];
  const result = await showPrompt({ title, body, options });
  if (step.var) engine.vars[step.var] = result;
}

/**
 * Insert text into a contentEditable element using the modern InputEvent API.
 * Falls back gracefully from execCommand → InputEvent + DOM mutation so that
 * React/Vue synthetic onChange handlers fire correctly.
 *
 * @param {HTMLElement} el - A focused contenteditable element
 * @param {string} text - Single character or string to insert at the caret
 * @returns {boolean}
 */
function insertTextIntoContentEditable(el, text) {
  el.focus();
  // Ensure a selection/caret exists at the end of the element
  const sel = window.getSelection();
  if (!sel.rangeCount) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  // Try execCommand first — still works on most Chromium versions and correctly
  // triggers React's synthetic event system.
  try {
    if (document.execCommand && document.execCommand('insertText', false, text)) {
      return true;
    }
  } catch { /* fall through to InputEvent approach */ }
  // Fallback: dispatch beforeinput + InputEvent + direct DOM mutation so that
  // frameworks listening to input events still receive the change.
  const dataTransfer = new DataTransfer();
  dataTransfer.setData('text/plain', text);
  el.dispatchEvent(new InputEvent('beforeinput', {
    inputType: 'insertText',
    data: text,
    dataTransfer,
    bubbles: true,
    cancelable: true
  }));
  // Direct DOM mutation at the current caret position
  const textNode = document.createTextNode(text);
  if (sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    el.appendChild(textNode);
  }
  el.dispatchEvent(new InputEvent('input', {
    inputType: 'insertText',
    data: text,
    dataTransfer,
    bubbles: true
  }));
  return true;
}

export async function typeText(step, engine) {
  const text = engine._resolve(step.text) || '';
  const opts = {};
  if (step.scope) opts.scope = step.scope;
  const el = step.selector
    ? engine.resolver.findOne(step.selector, opts)
    : engine._resolve(step.element);

  if (!el) return;

  el.focus();
  await DomOps.delay(100);

  if (el.contentEditable === 'true') {
    el.textContent = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // Type character-by-character with human-like delays to avoid bot detection.
    // insertTextIntoContentEditable fires proper InputEvents that React picks up.
    for (const char of text) {
      insertTextIntoContentEditable(el, char);
      await DomOps.delay(20 + Math.random() * 30);
    }
  } else {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el), 'value'
    )?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, text);
    } else {
      el.value = text;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
