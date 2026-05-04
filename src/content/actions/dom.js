/**
 * DOM engine actions: find, click, scroll, wait, navigation, security.
 */
import * as DomOps from '../dom-ops.js';

export function find(step, engine) {
  const opts = {};
  if (step.scope) opts.scope = step.scope;
  if (step.text) opts.text = engine._resolve(step.text);
  engine.vars[step.var] = engine.resolver.findOne(step.selector, opts);
}

export function findAll(step, engine) {
  const opts = {};
  if (step.scope) opts.scope = step.scope;
  if (step.text) opts.text = engine._resolve(step.text);
  engine.vars[step.var] = engine.resolver.findAll(step.selector, opts);
}

export function click(step, engine) {
  const el = engine._resolve(step.element);
  if (el) DomOps.click(el);
}

export async function wait(step, engine) {
  const ms = engine._resolve(step.ms);
  if (typeof ms !== 'number' || ms <= 0) return;
  // Poll in 250ms chunks so engine.stopRequested can interrupt long waits
  const chunkMs = 250;
  let waited = 0;
  while (waited < ms && !engine.stopRequested) {
    const remaining = ms - waited;
    await DomOps.delay(Math.min(chunkMs, remaining));
    waited += chunkMs;
  }
}

export function scroll(step) {
  DomOps.scroll(step.direction || 'bottom');
}

export function scrollIntoView(step, engine) {
  const el = engine._resolve(step.element);
  if (el) DomOps.scrollIntoView(el);
}

export function countElements(step, engine) {
  engine.vars[step.var] = engine.resolver.count(step.selector, step.fallbackKey);
}

export async function checkSecurity(step, engine, Overlay) {
  await DomOps.checkSecurity(engine.resolver, {
    updateStatus: (msg) => Overlay.updateStatus(msg),
    updateProgress: () => Overlay.updateProgress(
      engine.vars.processedCount || 0,
      engine.vars.totalCount || 0,
      engine.getElapsedSeconds()
    ),
    isStopRequested: () => engine.stopRequested,
    requestStop: () => engine.stop(),
    processedCount: engine.vars.processedCount || 0,
    totalCount: engine.vars.totalCount || 0,
    startTime: engine.startTime
  });
}

export async function dismissModal(step, engine) {
  await DomOps.dismissModal(engine.resolver);
}

export async function handleInviteModal(step, engine) {
  const sent = await DomOps.handleInviteModal(engine.resolver);
  if (step.var) engine.vars[step.var] = sent;
}

export function dismissDropdown() {
  DomOps.dismissDropdown();
}

export async function navigateNext(step, engine) {
  const result = await DomOps.navigateNext(engine.resolver);
  if (step.var) engine.vars[step.var] = result;
}

export async function waitForNew(step, engine) {
  const found = await DomOps.waitForNew(engine.resolver, step.selector, {
    maxAttempts: engine._resolve(step.maxAttempts) || 8,
    intervalMs: engine._resolve(step.intervalMs) || 300,
    fallbackKey: step.fallbackKey
  });
  if (step.var) engine.vars[step.var] = found;
}

export async function waitForElement(step, engine) {
  const found = await DomOps.waitForElement(engine.resolver, step.selector, {
    maxAttempts: engine._resolve(step.maxAttempts) || 15,
    intervalMs: engine._resolve(step.intervalMs) || 500
  });
  if (step.var) engine.vars[step.var] = found;
}

export async function verifyDropdown(step, engine) {
  const btn = engine._resolve(step.element);
  const key = step.verificationKey || step.selector;
  const result = await DomOps.verifyDropdownContains(btn, engine.resolver, key);
  if (step.var) engine.vars[step.var] = result;
}
