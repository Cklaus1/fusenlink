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
      const el = engine.resolver.findOne(fieldDef.childSelector, { scopeElement: container });
      if (fieldDef.attribute === 'exists') {
        item[fieldName] = el !== null;
      } else {
        item[fieldName] = el ? engine._extractAttribute(el, fieldDef.attribute) : null;
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
    for (const char of text) {
      try {
        if (!document.execCommand('insertText', false, char)) {
          el.textContent += char;
        }
      } catch {
        el.textContent += char;
      }
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
