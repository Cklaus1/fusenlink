/**
 * Playbook validation — checks structure before storage.
 * Prevents silent runtime failures from malformed JSON.
 */

import { ACTION_REGISTRY } from '../content/actions/index.js';

const CONTROL_FLOW_ACTIONS = ['loop', 'forEach', 'conditional', 'break'];
const ALL_KNOWN_ACTIONS = [...Object.keys(ACTION_REGISTRY), ...CONTROL_FLOW_ACTIONS];

const REQUIRED_FIELDS = ['id', 'version', 'name', 'urlPattern', 'steps'];

/**
 * Validate a playbook definition.
 *
 * Returns `{ valid, errors, warnings }`:
 *  - `errors` block save (valid=false when present)
 *  - `warnings` are informational — surfaced to the user but don't block save.
 *    Bug 27: `looksStaticallyFalse` matches now feed warnings instead of
 *    errors so that intentional placeholders like `breakIf: 'false'` (used
 *    during playbook authoring/testing) don't refuse to save.
 *
 * Existing callers that destructure `{ valid, errors }` continue to work;
 * `warnings` is additive.
 * @param {Object} playbook
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validatePlaybook(playbook) {
  const errors = [];
  const warnings = [];

  if (!playbook || typeof playbook !== 'object') {
    return { valid: false, errors: ['Playbook must be a non-null object'], warnings };
  }

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (!playbook[field]) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  // Type checks
  if (playbook.version && typeof playbook.version !== 'number') {
    errors.push('"version" must be a number');
  }

  if (playbook.urlPattern) {
    try {
      new RegExp(playbook.urlPattern);
    } catch {
      errors.push(`Invalid urlPattern regex: "${playbook.urlPattern}"`);
    }
  }

  if (playbook.trustLevel && !['auto', 'review', 'interactive'].includes(playbook.trustLevel)) {
    errors.push(`Invalid trustLevel: "${playbook.trustLevel}" (must be auto, review, or interactive)`);
  }

  // Validate steps
  if (Array.isArray(playbook.steps)) {
    if (playbook.steps.length === 0) {
      errors.push('"steps" array must not be empty');
    } else {
      validateSteps(playbook.steps, errors, warnings, 'steps');
    }
  } else if (playbook.steps) {
    errors.push('"steps" must be an array');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Recursively validate step arrays.
 * @param {Object[]} steps
 * @param {string[]} errors
 * @param {string[]} warnings
 * @param {string} path - For error messages
 */
function validateSteps(steps, errors, warnings, path) {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepPath = `${path}[${i}]`;

    if (!step || typeof step !== 'object') {
      errors.push(`${stepPath}: step must be an object`);
      continue;
    }

    if (!step.action) {
      errors.push(`${stepPath}: missing "action" field`);
      continue;
    }

    if (!ALL_KNOWN_ACTIONS.includes(step.action)) {
      errors.push(`${stepPath}: unknown action "${step.action}"`);
    }

    // Validate nested steps in control flow
    if (step.action === 'loop' || step.action === 'forEach') {
      if (step.steps) validateSteps(step.steps, errors, warnings, `${stepPath}.steps`);
    }
    if (step.action === 'conditional') {
      if (!step.condition) {
        errors.push(`${stepPath}: conditional requires "condition"`);
      }
      if (step.onTrue) validateSteps(step.onTrue, errors, warnings, `${stepPath}.onTrue`);
      if (step.onFalse) validateSteps(step.onFalse, errors, warnings, `${stepPath}.onFalse`);
    }
    // Bug 11: loops without a termination guard silently spin forever.
    if (step.action === 'loop') {
      if (!step.breakIf && typeof step.maxIterations !== 'number') {
        errors.push(`${stepPath}: loop requires "breakIf" expression OR "maxIterations" number`);
      }
      // Bug 16/27: a literal `breakIf: 'false'` (or another statically-false
      // literal with no $variable references) will never break the loop.
      // We surface this as a *warning* rather than an error so authors can
      // intentionally stub `breakIf: 'false'` while iterating on a playbook
      // (Bug 27). The catch is conservative — only well-known constants —
      // because we no longer import the full expression evaluator from
      // content/ (Bug 4 layering fix).
      if (step.breakIf && looksStaticallyFalse(step.breakIf)) {
        warnings.push(`${stepPath}: breakIf "${step.breakIf}" appears to always be false — loop will never break`);
      }
    }
    if (step.action === 'forEach') {
      if (!step.items) errors.push(`${stepPath}: forEach requires "items"`);
      if (!step.itemVar) errors.push(`${stepPath}: forEach requires "itemVar"`);
    }
  }
}

/**
 * Bug 4 / Bug 16: detect breakIf expressions that are well-known static
 * falsy literals AND have no $variable references.
 *
 * Layering note: this used to import `evaluate` from `../content/expression.js`,
 * but `playbook-validator.js` lives in `src/shared/` and must not depend on
 * `src/content/`. The conservative inline check here trades coverage for
 * isolation: it catches the common typos (`'false'`, `'0'`, `'null'`, `''`)
 * but won't catch composed expressions like `'0 + 0'`. That's acceptable —
 * the validator's job is to flag obvious mistakes, not to reproduce the
 * full evaluator semantics.
 * @param {string} expr
 * @returns {boolean}
 */
export function looksStaticallyFalse(expr) {
  if (!expr || typeof expr !== 'string') return false;
  const trimmed = expr.trim();
  // If expr references any $variable, can't statically evaluate.
  if (/\$\w/.test(trimmed)) return false;
  // Match well-known static-false literals only.
  return /^(false|0|null|undefined|''|"")$/.test(trimmed);
}

const VALID_STRATEGY_TYPES = ['css', 'cssWithText', 'ariaLabel', 'textExact', 'textMatch', 'hasChild'];

/**
 * Bug 1: top-level metadata keys in a selector registry are not selector
 * entries — they're documentation/version fields. The previous
 * `key === 'version'` check missed `description`, `notes`, `updatedAt`,
 * causing shipped registries with those fields to fail validation.
 */
const SELECTOR_METADATA_KEYS = new Set(['version', 'description', 'notes', 'updatedAt']);

/**
 * Bug 18: validate a selector registry (the value side of
 * DEFAULT_SELECTOR_REGISTRIES — e.g. the object under
 * `linkedin.invitations`). Mirrors validatePlaybook's contract so callers
 * can use the same { valid, errors } pattern.
 * @param {Object} registry
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSelectorRegistry(registry) {
  const errors = [];
  if (!registry || typeof registry !== 'object') {
    return { valid: false, errors: ['Registry must be an object'] };
  }
  for (const [key, entry] of Object.entries(registry)) {
    if (SELECTOR_METADATA_KEYS.has(key)) continue; // metadata: version/description/notes/updatedAt
    if (!entry || typeof entry !== 'object') {
      errors.push(`${key}: entry must be an object`);
      continue;
    }
    if (!Array.isArray(entry.strategies) || entry.strategies.length === 0) {
      errors.push(`${key}: strategies must be a non-empty array`);
      continue;
    }
    for (let i = 0; i < entry.strategies.length; i++) {
      const s = entry.strategies[i];
      if (!s || typeof s !== 'object') {
        errors.push(`${key}.strategies[${i}]: must be an object`);
        continue;
      }
      if (!s.type) {
        errors.push(`${key}.strategies[${i}]: missing type`);
        continue;
      }
      if (!VALID_STRATEGY_TYPES.includes(s.type)) {
        errors.push(`${key}.strategies[${i}]: unknown type "${s.type}"`);
        continue;
      }
      // ariaLabel filters by `pattern`, not `value`, so the value field
      // is optional for that strategy.
      if (typeof s.value !== 'string' && s.type !== 'ariaLabel') {
        errors.push(`${key}.strategies[${i}]: missing value (string)`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
