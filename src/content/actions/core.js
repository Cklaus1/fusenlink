/**
 * Core engine actions: variables, control flow helpers, progress.
 */

export function setVar(step, engine) {
  engine.vars[step.var] = engine._resolve(step.value);
}

export function incrementVar(step, engine) {
  engine.vars[step.var] = (engine.vars[step.var] || 0) + 1;
}

export function appendArray(step, engine) {
  const existing = engine.vars[step.var] || [];
  const newItems = engine._resolve(step.items);
  if (Array.isArray(newItems)) {
    engine.vars[step.var] = [...existing, ...newItems];
  }
}

export function updateProgress(step, engine, Overlay) {
  Overlay.updateProgress(
    engine._resolve(step.processed) ?? engine.vars.processedCount ?? 0,
    engine._resolve(step.total) ?? engine.vars.totalCount ?? 0,
    engine.getElapsedSeconds()
  );
}

export function log(step, engine, Overlay) {
  Overlay.updateStatus(engine._resolve(step.message) || step.message);
}
