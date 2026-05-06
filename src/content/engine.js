/**
 * PlaybookEngine — interprets playbook JSON step sequences.
 *
 * The engine is a thin dispatcher: each action type is a handler function
 * registered in the ACTION_REGISTRY. Control flow (loop, forEach, conditional)
 * and trust level gates live here; everything else is delegated.
 */

import { evaluate, resolveValue } from './expression.js';
import { SelectorResolver } from './selector-resolver.js';
import * as DomOps from './dom-ops.js';
import * as Overlay from '../ui/overlay.js';
import { sendMessage } from '../shared/storage.js';
import { MSG, TRUST_LEVEL, WRITE_ACTIONS } from '../shared/messages.js';
import { showPrompt } from '../ui/ai-panel.js';
import { ACTION_REGISTRY } from './actions/index.js';

// Sentinel for breaking out of loops
class BreakSignal {}

/**
 * Bug 9 / Bug 29: persist the "we already warned about this playbook's
 * safetyCap" flag in chrome.storage so the warning isn't re-issued every
 * time the SW spins up a fresh engine instance. Without this, the same
 * playbook spam-warns daily (or on each SW wakeup). 24h TTL; entries
 * older than 7 days are pruned on write.
 *
 * @param {string} playbookId
 * @returns {Promise<boolean>} true if a warning was emitted within the last 24h
 */
export async function isAlreadyWarned(playbookId) {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get('meta.warnedSafetyCaps', r => {
        const map = (r && r['meta.warnedSafetyCaps']) || {};
        const ts = map[playbookId];
        if (!ts) return resolve(false);
        if (Date.now() - ts > 86400000) return resolve(false); // 24h TTL
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Bug 9 / Bug 29: record a safetyCap warning for this playbook, with TTL
 * pruning of stale entries older than 7 days.
 * @param {string} playbookId
 */
export function markWarned(playbookId) {
  try {
    chrome.storage.local.get('meta.warnedSafetyCaps', r => {
      const map = (r && r['meta.warnedSafetyCaps']) || {};
      map[playbookId] = Date.now();
      const cutoff = Date.now() - 7 * 86400000;
      for (const k of Object.keys(map)) {
        if (map[k] < cutoff) delete map[k];
      }
      try { chrome.storage.local.set({ 'meta.warnedSafetyCaps': map }); } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
}

/**
 * Bug 8: utility to scrub stale "in_progress" activity-log entries written
 * by older engine versions that didn't tag entries with a runId. Marks any
 * such legacy in-progress row older than 1 hour as 'orphaned' so the popup's
 * non-complete filter excludes it from daily sums. Not invoked from the
 * engine itself — exported for the playbook-store migration path.
 *
 * @param {Array<Object>} entries - raw activityLog rows
 * @returns {Array<Object>} new array with orphaned legacy rows tagged
 */
export function migrateLegacyActivityLog(entries) {
  if (!Array.isArray(entries)) return entries;
  const now = Date.now();
  return entries.map(entry => {
    if (!entry || entry.runId) return entry;
    if (entry.outcome !== 'in_progress') return entry;
    const ts = entry.timestamp || entry.ts || 0;
    if (now - ts < 3600000) return entry; // <1h old, leave alone
    return { ...entry, outcome: 'orphaned' };
  });
}

/**
 * Bug 17: classify a step error so the AI knows whether to retry or abandon.
 * Transient and rate_limit errors are typically worth retrying; auth errors
 * are not. The AI prompt instructs the model to honor errorClass.
 * @param {string} msg
 * @returns {('transient'|'auth'|'rate_limit'|'unknown'|null)}
 */
export function classifyError(msg) {
  if (!msg) return null;
  // Bug 9: expanded transient patterns beyond ECONNREFUSED/timeout/fetch/network
  // to cover DNS (EAI_AGAIN), routing (EHOSTUNREACH/ENETUNREACH), socket
  // resets, and ETIMEDOUT — common Node/network errors that previously
  // fell through to "unknown".
  if (/timeout|aborted|ECONN|EAI_|EHOST|ENET|ETIMEDOUT|fetch|network|dns|socket hang up|connection reset/i.test(msg)) return 'transient';
  if (/401|403|invalid api key|unauthor/i.test(msg)) return 'auth';
  if (/429|rate limit|quota/i.test(msg)) return 'rate_limit';
  return 'unknown';
}

const INTERACTIVE_SYSTEM_PROMPT = `You are an AI agent controlling a LinkedIn browser automation extension.
You receive the current page state and must decide what actions to take next.

AVAILABLE ACTIONS (use these as the "action" field):
- extract: Read structured data. Requires "var", "selectors" (object mapping fieldName → {selector, attribute}).
- click: Click an element. Requires "element" (CSS selector string to find it) or use "find" first.
- find: Find an element. Requires "selector" (registry key or CSS), "var" to store result.
- findAll: Find all matching elements. Requires "selector", "var".
- navigate: Go to a URL. Requires "url".
- scroll: Scroll the page. Requires "direction" ("top" or "bottom").
- wait: Wait. Requires "ms" (milliseconds).
- typeText: Type into input. Requires "selector", "text".
- getPageContent: Get page text. Requires "var".
- log: Show status message. Requires "message".
- prompt: Ask the user a question. Requires "title", "body", "options" (array), "var".
- done: Signal task completion.

Respond with JSON:
{
  "reasoning": "Brief explanation of your plan",
  "steps": [array of action objects],
  "done": false
}

Or to finish:
{
  "reasoning": "Task complete because...",
  "summary": "What was accomplished",
  "done": true
}

RULES:
- Maximum 5 steps per response
- Always explain your reasoning
- Use "prompt" to ask the user when uncertain
- Never auto-send messages or accept connections without user confirmation
- Prefer reading data before acting on it
- If previousResults.errorClass is "transient" or "rate_limit", retry the same step rather than abandoning the task. Only abandon on "auth" or repeated "unknown" errors.`;

export class PlaybookEngine {
  /**
   * @param {Object} playbook - Playbook definition (JSON)
   * @param {Object} selectorRegistry - Selector registry for this playbook
   * @param {Object} [globalSettings] - User settings override
   */
  constructor(playbook, selectorRegistry, globalSettings = {}) {
    this.playbook = playbook;
    this.resolver = new SelectorResolver(selectorRegistry);
    this.settings = { ...playbook.settings, ...globalSettings };
    this.vars = { settings: this.settings };
    this.stopRequested = false;
    this.startTime = 0;
    // Session-approval model for REVIEW trust level — see _executeStep.
    // Bug 6: avoid prompting for every write action during bulk operations.
    this._reviewBatchSize = playbook.settings?.reviewBatchSize || 10;
    this._reviewApprovedRemaining = 0;
    this._reviewApproveAll = false;
    // Bug 1: track loop nesting depth so aiCall can decide to throw (outside
    // loops) or swallow+log (inside loops) on transient errors.
    this._loopDepth = 0;
    // Bug 27 / Bug 9 / Bug 29: dedup of safetyCap warnings now lives in
    // chrome.storage (see isAlreadyWarned/markWarned) so the cache survives
    // SW sleeps and fresh engine instances. The constructor no longer keeps
    // an in-memory Set.
    // Bug 4 / Bug 21: stable id shared across all activity-log entries from a
    // single run. The popup uses this to dedupe checkpoints against the
    // canonical _finalize entry.
    this._runId = null;
    // Per-step timings ([{stepIdx, action, durationMs, error?}]) — populated
    // by _executeStep and attached to the activity-log entry in _finalize.
    // Lets us see where time goes in a run (e.g. inbox-analysis: 95% in aiCall).
    this._perfSteps = [];
    this._stepCounter = 0;
  }

  /**
   * Run the playbook.
   * @returns {Promise<{processedCount: number, skippedCount: number, stopped: boolean, error?: string}>}
   */
  async run() {
    this.stopRequested = false;
    this.startTime = Date.now();
    // Bug 4: assign a runId at the start so checkpoints + the final entry
    // share the same id. The popup uses this to dedupe checkpoints against
    // the canonical _finalize entry when summing daily counts.
    this._runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.vars = {
      settings: this.settings,
      stopRequested: false,
      processedCount: 0,
      skippedCount: 0,
      totalCount: 0
    };

    // Interactive mode: AI agent drives the playbook instead of static steps
    if (this.playbook.trustLevel === TRUST_LEVEL.INTERACTIVE) {
      const userRequest = this.playbook.userRequest || this.playbook.description || this.playbook.name;
      return this.runInteractive(userRequest, {
        maxCycles: this.playbook.settings?.maxCycles || 20
      });
    }

    Overlay.showOverlay(this.playbook.name);
    Overlay.updateStatus('Starting...');
    Overlay.onStop(() => this.stop());

    let runError = null;
    try {
      await this._executeSteps(this.playbook.steps);
    } catch (err) {
      if (!(err instanceof BreakSignal)) {
        console.error('PlaybookEngine error:', err);
        Overlay.updateStatus(`Error: ${err.message}`);
        runError = err.message;
      }
    }

    const result = {
      processedCount: this.vars.processedCount || 0,
      skippedCount: this.vars.skippedCount || 0,
      stopped: this.stopRequested,
      ...(runError ? { error: runError } : {})
    };

    return await this._finalize(result, runError);
  }

  /**
   * Finalize a run \u2014 emit summary overlay text and write the activity log entry.
   * Shared between static (run) and interactive (runInteractive) execution paths
   * so interactive sessions also appear in History.
   * @param {Object} result
   * @param {string|null} runError
   * @returns {Promise<Object>} the same result object
   */
  async _finalize(result, runError) {
    const summaryParts = [];
    if (result.summary) {
      summaryParts.push(result.summary);
    } else if (this.stopRequested) {
      summaryParts.push(`Cancelled \u2013 ${result.processedCount} processed`);
    } else {
      summaryParts.push(`Completed \u2013 ${result.processedCount} processed`);
    }
    if (result.skippedCount > 0) {
      summaryParts.push(`(${result.skippedCount} skipped)`);
    }
    Overlay.showSummary(summaryParts.join(' '));

    // Build a compact perf summary: top 5 slowest steps + totals per action.
    // Full step list would bloat the activity log; the summary is enough to
    // answer "where did the time go?" without burning storage on every run.
    const perfSummary = (() => {
      if (!this._perfSteps?.length) return null;
      const byAction = {};
      for (const s of this._perfSteps) {
        if (!byAction[s.action]) byAction[s.action] = { count: 0, totalMs: 0 };
        byAction[s.action].count++;
        byAction[s.action].totalMs += s.durationMs || 0;
      }
      const slowest = [...this._perfSteps]
        .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0))
        .slice(0, 5)
        .map(s => ({ action: s.action, ms: s.durationMs }));
      return { byAction, slowest };
    })();

    // Log activity
    sendMessage({
      action: MSG.LOG_ACTIVITY,
      entry: {
        // Bug 4: shared runId lets the popup dedupe this canonical entry
        // against any earlier in-progress checkpoint entries.
        ...(this._runId ? { runId: this._runId } : {}),
        playbookId: this.playbook.id,
        action: 'playbook_run',
        outcome: runError ? 'error' : (this.stopRequested ? 'stopped' : 'complete'),
        processedCount: result.processedCount,
        skippedCount: result.skippedCount,
        durationMs: Date.now() - this.startTime,
        ...(perfSummary ? { perf: perfSummary } : {}),
        ...(result.tokensUsed ? { tokensUsed: result.tokensUsed } : {}),
        ...(result.summary ? { summary: result.summary } : {}),
        // Bug 22: surface per-cycle cost breakdown for interactive runs
        // so the popup can render a budget timeline.
        ...(result.cycleHistory ? { cycleHistory: result.cycleHistory } : {}),
        ...(runError ? { error: runError } : {})
      }
    }).catch(() => {});

    return result;
  }

  /**
   * Run in interactive AI mode — agent loop where the LLM observes the page,
   * reasons about what to do, and issues action steps dynamically.
   * @param {string} userRequest
   * @param {Object} [options]
   * @param {number} [options.maxCycles=20]
   * @returns {Promise<Object>}
   */
  async runInteractive(userRequest, options = {}) {
    let snapshot;
    try {
      ({ snapshot } = await import('./page-observer.js'));
    } catch (err) {
      return { success: false, error: `Failed to load page observer: ${err.message}` };
    }

    this.stopRequested = false;
    this.startTime = Date.now();
    // Bug 4 / Bug 21: ensure interactive runs also get a runId. (run() sets
    // this when it dispatches to runInteractive, but direct callers may
    // bypass run() and reach this method.)
    if (!this._runId) {
      this._runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    const maxCycles = options.maxCycles || 20;
    const maxTokensBudget = this.playbook.settings?.maxTokensBudget || 100000;
    let totalTokensUsed = 0;
    this._lastInteractiveSummary = null;
    // Bug 22: track per-cycle token usage so _finalize can surface a
    // breakdown in the activity log entry. Capped at the last 20 cycles
    // to keep the log entry size bounded.
    const cycleHistory = [];

    Overlay.showOverlay('AI Interactive Mode');
    Overlay.updateStatus('Observing page...');
    Overlay.onStop(() => this.stop());

    let previousResults = null;
    let runError = null;
    // Bug 16: track the last reasoning + exit reason so we always have
    // *something* to surface as a summary, even if maxCycles exhausts
    // without a `done` plan.
    let lastReasoning = null;
    let exitReason = 'max_cycles';
    let cyclesExecuted = 0;

    try {
      for (let cycle = 0; cycle < maxCycles; cycle++) {
        cyclesExecuted = cycle + 1;
        if (this.stopRequested) { exitReason = 'stopped'; break; }

        const pageState = snapshot();

        Overlay.updateStatus(`Thinking... (cycle ${cycle + 1}/${maxCycles})`);
        const aiResponse = await sendMessage({
          action: MSG.AI_REQUEST,
          aiType: 'interactive_step',
          input: JSON.stringify({
            userRequest,
            pageState,
            previousResults,
            cycle: cycle + 1,
            maxCycles
          }),
          systemPrompt: INTERACTIVE_SYSTEM_PROMPT
        });

        // Track token usage and enforce budget
        const used = (aiResponse?.usage?.prompt_tokens || 0) + (aiResponse?.usage?.completion_tokens || 0);
        totalTokensUsed += used;
        // Bug 22: capture per-cycle cost so the popup/history view can
        // explain *which* cycles drove the budget exhaustion.
        cycleHistory.push({
          cycle: cycle + 1,
          tokensUsed: used,
          ...(aiResponse?.parsed?.reasoning
            ? { reasoning: String(aiResponse.parsed.reasoning).slice(0, 200) }
            : {})
        });
        Overlay.updateStatus(`Tokens: ${totalTokensUsed}/${maxTokensBudget} (cycle ${cycle + 1}/${maxCycles})`);
        if (totalTokensUsed > maxTokensBudget) {
          Overlay.updateStatus(`Token budget exceeded (${totalTokensUsed}/${maxTokensBudget}) — stopping`);
          exitReason = 'budget';
          break;
        }

        let plan = aiResponse?.parsed;
        if (!plan) {
          // Single retry with a stricter system prompt before giving up.
          Overlay.updateStatus('Retrying with stricter prompt...');
          const retry = await sendMessage({
            action: MSG.AI_REQUEST,
            aiType: 'interactive_step',
            input: JSON.stringify({ userRequest, pageState, previousResults, cycle: cycle + 1, maxCycles }),
            systemPrompt: INTERACTIVE_SYSTEM_PROMPT + '\n\nIMPORTANT: respond with JSON only, no surrounding text or markdown.'
          });
          const retryUsed = (retry?.usage?.prompt_tokens || 0) + (retry?.usage?.completion_tokens || 0);
          totalTokensUsed += retryUsed;
          plan = retry?.parsed;
        }
        if (!plan) {
          Overlay.updateStatus('AI returned no actionable plan');
          exitReason = 'no_plan';
          break;
        }

        // Bug 16: capture each cycle's reasoning so we can fall back to it
        // when no explicit done summary is produced.
        if (plan.reasoning) lastReasoning = plan.reasoning;

        if (plan.done || plan.action === 'done') {
          Overlay.updateStatus(plan.summary || 'Task complete');
          this._lastInteractiveSummary = plan.summary || null;
          exitReason = 'done';
          break;
        }

        const steps = plan.steps || (plan.action ? [plan] : []);
        if (steps.length === 0) { exitReason = 'no_plan'; break; }

        Overlay.updateStatus(plan.reasoning || 'Executing...');

        let stepError = null;
        let executedCount = 0;
        for (const step of steps) {
          if (this.stopRequested) break;
          try {
            await this._executeStep(step);
            executedCount++;
          } catch (err) {
            stepError = err.message;
            break;
          }
        }

        // Bug 8: bound previousResults to a fixed-size summary. Bounded
        // context is critical for the token-budget enforcement above to be
        // meaningful — without this cap, vars accumulate across cycles and
        // every cycle's prompt grows unboundedly large.
        // Bug 17: classify any step error so the AI can decide whether to
        // retry (transient/rate_limit) or abandon (auth).
        previousResults = {
          executedSteps: executedCount,
          vars: this._boundedVarsSnapshot(),
          ...(stepError
            ? { error: stepError, errorClass: classifyError(stepError), lastStepError: stepError }
            : { lastStepError: null })
        };

        await DomOps.delay(500);
      }
    } catch (err) {
      console.error('Interactive mode error:', err);
      Overlay.updateStatus(`Error: ${err.message}`);
      runError = err.message;
      exitReason = 'error';
    }

    // Bug 16: pick the best summary we have. Priority:
    //   1. explicit AI-provided summary on done
    //   2. last reasoning string we saw mid-loop
    //   3. a generic "ended after N cycles" string
    const summary = this._lastInteractiveSummary
      || lastReasoning
      || `Ended after ${cyclesExecuted} cycle${cyclesExecuted === 1 ? '' : 's'} without summary`;

    const result = {
      processedCount: this.vars.processedCount || 0,
      skippedCount: this.vars.skippedCount || 0,
      stopped: this.stopRequested,
      tokensUsed: totalTokensUsed,
      summary,
      exitReason,
      // Bug 22: cap to the last 20 cycles so the log entry stays bounded
      // even on long runs that approach maxCycles=100+.
      ...(cycleHistory.length > 0 ? { cycleHistory: cycleHistory.slice(-20) } : {}),
      ...(runError ? { error: runError } : {})
    };

    return await this._finalize(result, runError);
  }

  /** Request the engine to stop. */
  stop() {
    this.stopRequested = true;
    this.vars.stopRequested = true;
    Overlay.updateStatus('Stopping at next opportunity...');
  }

  /** @returns {boolean} */
  isStopRequested() {
    return this.stopRequested;
  }

  /** @returns {number} */
  getElapsedSeconds() {
    return (Date.now() - this.startTime) / 1000;
  }

  /**
   * Execute an array of steps sequentially.
   * @param {Object[]} steps
   */
  async _executeSteps(steps) {
    if (!steps) return;
    for (const step of steps) {
      if (this.stopRequested) return;
      await this._executeStep(step);
    }
  }

  /**
   * Execute a single step — dispatches to action registry or handles control flow.
   * @param {Object} step
   */
  async _executeStep(step) {
    const stepIdx = this._stepCounter++;
    const t0 = Date.now();
    const recordPerf = (extra = {}) => {
      this._perfSteps.push({ stepIdx, action: step.action, durationMs: Date.now() - t0, ...extra });
    };
    // Control flow — handled directly by the engine (no trust gate needed).
    // We still record perf for these so the breakdown reflects loop/forEach time.
    switch (step.action) {
      case 'loop': {
        const r = await this._executeLoop(step);
        recordPerf();
        return r;
      }
      case 'forEach': {
        const r = await this._executeForEach(step);
        recordPerf();
        return r;
      }
      case 'conditional': {
        const r = await this._executeConditional(step);
        recordPerf();
        return r;
      }
      case 'break':
        recordPerf({ break: true });
        throw new BreakSignal();
    }

    // All other actions — dispatch to registry
    const handler = ACTION_REGISTRY[step.action];
    if (!handler) {
      console.warn(`PlaybookEngine: unknown action "${step.action}"`);
      return;
    }

    // Validate required fields per action type
    const missing = this._checkRequiredFields(step);
    if (missing) {
      console.warn(`PlaybookEngine: action "${step.action}" missing required field "${missing}"`);
      return;
    }

    // Trust level gate — only prompt for valid write actions.
    // REVIEW trust level uses a session-approval model (Bug 6): a single
    // prompt grants approval for the next N writes, "all", or stops.
    const trustLevel = this.playbook.trustLevel || TRUST_LEVEL.AUTO;
    if (trustLevel === TRUST_LEVEL.REVIEW && WRITE_ACTIONS.includes(step.action)) {
      if (this._reviewApproveAll) {
        // Already approved for the rest of the session — proceed.
      } else if (this._reviewApprovedRemaining > 0) {
        this._reviewApprovedRemaining--;
      } else {
        const batchSize = this._reviewBatchSize;
        const description = step._description || `Execute "${step.action}" action?`;
        const approveNextLabel = `Approve next ${batchSize}`;
        const approveAllLabel = 'Approve all';
        const result = await showPrompt({
          title: 'Confirm Action',
          body: description,
          options: [approveNextLabel, approveAllLabel, 'Skip', 'Stop']
        });
        if (result === 'Stop') {
          this.stop();
          return;
        }
        if (result === 'Skip') return;
        if (result === approveAllLabel) {
          this._reviewApproveAll = true;
        } else if (result === approveNextLabel) {
          // This action plus N-1 more.
          this._reviewApprovedRemaining = Math.max(0, batchSize - 1);
        } else {
          // Unknown response — treat as skip for safety.
          return;
        }
      }
    }

    try {
      await handler(step, this, Overlay);
      recordPerf();
    } catch (err) {
      // Bug 35: surface lastError so subsequent steps can check $lastError.
      this.vars.lastError = err && err.message ? err.message : String(err);
      recordPerf({ error: this.vars.lastError });
      throw err;
    }
  }

  /**
   * Check that required fields are present for an action step.
   * @param {Object} step
   * @returns {string|null} Name of missing field, or null if valid
   */
  _checkRequiredFields(step) {
    const REQUIRED = {
      find: ['selector', 'var'],
      findAll: ['selector', 'var'],
      click: ['element'],
      wait: ['ms'],
      scroll: ['direction'],
      typeText: ['selector', 'text'],
      extract: ['var'],
      navigate: ['url'],
      countElements: ['selector', 'var'],
      waitForElement: ['selector'],
      waitForNew: ['selector'],
      prompt: ['title', 'body', 'options', 'var'],
      log: ['message'],
      getPageContent: ['var']
    };
    const required = REQUIRED[step.action];
    if (!required) return null;
    for (const field of required) {
      if (step[field] === undefined || step[field] === null) return field;
    }
    return null;
  }

  /**
   * Extract an attribute value from a DOM element.
   * @param {HTMLElement} el
   * @param {string} attribute
   * @returns {string|null}
   */
  _extractAttribute(el, attribute) {
    if (!el) return null;
    if (attribute === 'textContent') return el.textContent.trim();
    if (attribute === 'innerText') return (el.innerText || el.textContent || '').trim();
    return el.getAttribute(attribute);
  }

  /** Execute a loop step. */
  async _executeLoop(step) {
    // Bug 12: prefer the new "safetyCap" field over legacy "maxIterations".
    // Both mean the same thing — a hard cap on iterations regardless of
    // breakIf — but safetyCap is the surfaced name authors should use.
    // Bug 8: when the author has provided a breakIf, trust them and default
    // the cap to Infinity. The 10000 fallback only applies when neither
    // breakIf nor an explicit cap is set (the validator should reject this
    // case, but we keep it as a safety net).
    let cap;
    if (typeof step.safetyCap === 'number') cap = step.safetyCap;
    else if (typeof step.maxIterations === 'number') cap = step.maxIterations;
    else if (step.breakIf) cap = Infinity;
    else cap = 10000;
    let iter = 0;
    // Bug 1: track loop nesting so aiCall can decide to throw vs. swallow.
    this._loopDepth = (this._loopDepth || 0) + 1;
    try {
      while (!this.stopRequested) {
        if (iter >= cap) {
          if (cap !== Infinity) {
            // Bug 27 / Bug 9 / Bug 29: dedup warnings via chrome.storage so
            // the cache survives SW sleeps and fresh engine instances. 24h
            // TTL — same playbook hitting its cap won't spam-warn daily.
            const id = this.playbook.id;
            if (!(await isAlreadyWarned(id))) {
              console.warn(`PlaybookEngine: loop hit safetyCap ${cap} (playbook=${id}); breaking.`);
              markWarned(id);
            }
          }
          break;
        }
        if (step.breakIf) {
          if (evaluate(step.breakIf, this.vars)) break;
        }
        // Bug 11: clear lastError at the start of each iteration so a stale
        // error from a previous iteration doesn't poison subsequent ones.
        delete this.vars.lastError;
        try {
          await this._executeSteps(step.steps);
        } catch (err) {
          if (err instanceof BreakSignal) break;
          throw err;
        }
        iter++;
        // Bug 9: periodic checkpoint so progress is recorded even if the page
        // reloads mid-run.
        if (iter % 10 === 0) this._emitCheckpoint();
      }
    } finally {
      this._loopDepth = Math.max(0, (this._loopDepth || 1) - 1);
    }
  }

  /** Execute a forEach step. */
  async _executeForEach(step) {
    const items = this._resolve(step.items);
    if (!items || !Array.isArray(items)) return;

    // Bug 1: mark loop context so aiCall throws-outside / swallows-inside.
    this._loopDepth = (this._loopDepth || 0) + 1;
    try {
      let iter = 0;
      for (const item of items) {
        if (this.stopRequested) break;
        if (step.breakIf && evaluate(step.breakIf, this.vars)) break;

        this.vars[step.itemVar] = item;
        // Bug 11: fresh slate per iteration — a transient error on item N
        // shouldn't leave $lastError set when iterating item N+1.
        delete this.vars.lastError;

        try {
          await this._executeSteps(step.steps);
        } catch (err) {
          if (err instanceof BreakSignal) break;
          throw err;
        }
        iter++;
        // Bug 9: periodic checkpoint mirrors the loop path.
        if (iter % 10 === 0) this._emitCheckpoint();
      }
    } finally {
      this._loopDepth = Math.max(0, (this._loopDepth || 1) - 1);
    }
  }

  /** Execute a conditional step. */
  async _executeConditional(step) {
    const result = evaluate(step.condition, this.vars);
    if (result) {
      if (step.onTrue) await this._executeSteps(step.onTrue);
    } else {
      if (step.onFalse) await this._executeSteps(step.onFalse);
    }
  }

  /**
   * Resolve a $variable reference or return the literal value.
   * @param {any} value
   * @returns {any}
   */
  _resolve(value) {
    return resolveValue(value, this.vars);
  }

  /**
   * Create a sanitized snapshot of vars for sending to LLM.
   * Strips DOM refs, summarizes large arrays.
   * @returns {Object}
   */
  _sanitizeVarsForAI() {
    const safe = {};
    for (const [key, value] of Object.entries(this.vars)) {
      if (value instanceof HTMLElement || value instanceof Node) continue;
      if (Array.isArray(value) && value.length > 0 && value[0] instanceof HTMLElement) {
        safe[key] = `[${value.length} DOM elements]`;
        continue;
      }
      if (key === 'settings') continue;
      if (Array.isArray(value) && value.length > 20) {
        safe[key] = { _type: 'array', length: value.length, sample: value.slice(0, 3) };
        continue;
      }
      safe[key] = value;
    }
    return safe;
  }

  /**
   * Bounded snapshot of vars for inclusion in previousResults sent to the AI.
   * Builds on _sanitizeVarsForAI, then truncates strings >500 chars and
   * arrays >10 items (keeping first 3 + last 3 + length). Bounded context
   * is critical for token-budget enforcement to remain meaningful — without
   * a cap, vars accumulate across cycles and the prompt grows unboundedly.
   * @returns {Object}
   */
  _boundedVarsSnapshot() {
    // Walk raw vars so we own array bounding here. Mirrors the DOM-ref
    // stripping from _sanitizeVarsForAI but applies tighter caps.
    const out = {};
    for (const [key, value] of Object.entries(this.vars)) {
      if (key === 'settings') continue;
      if (value instanceof HTMLElement || value instanceof Node) continue;
      if (Array.isArray(value) && value.length > 0 && value[0] instanceof HTMLElement) {
        out[key] = `[${value.length} DOM elements]`;
        continue;
      }
      if (typeof value === 'string' && value.length > 500) {
        out[key] = value.slice(0, 500) + `... [truncated, total ${value.length} chars]`;
      } else if (Array.isArray(value) && value.length > 10) {
        const head = value.slice(0, 3);
        const tail = value.slice(-3);
        out[key] = { _type: 'array', length: value.length, head, tail };
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  /**
   * Emit a checkpoint activity log entry mid-run so progress isn't lost
   * if the page reloads before _finalize. Called from loop and forEach
   * every Nth iteration. The History tab consumer should treat
   * 'in_progress' outcomes as partial entries.
   *
   * Bug 35: _emitCheckpoint uses fire-and-forget sendMessage. If the SW is
   * killed between checkpoints, in-flight log writes are lost. This is
   * acceptable because final _finalize emits the canonical entry; checkpoints
   * exist only to surface in-progress state for runs that crash before
   * _finalize.
   *
   * Bug 4 / Bug 21: every entry carries the run's stable runId so the popup
   * can dedupe checkpoints against the canonical _finalize entry instead of
   * triple-counting processedCount in daily totals.
   *
   * Bug 8: runId is REQUIRED for proper popup-side deduplication. Pre-migration
   * legacy entries written by older engine versions lack runId and must be
   * filtered/repaired by the popup-side store (see migrateLegacyActivityLog).
   */
  _emitCheckpoint() {
    sendMessage({
      action: MSG.LOG_ACTIVITY,
      entry: {
        ...(this._runId ? { runId: this._runId } : {}),
        playbookId: this.playbook.id,
        action: 'playbook_checkpoint',
        outcome: 'in_progress',
        processedCount: this.vars.processedCount || 0,
        skippedCount: this.vars.skippedCount || 0,
        durationMs: Date.now() - this.startTime
      }
    }).catch(() => {});
  }
}
