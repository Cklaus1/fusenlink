/**
 * Playbook validation — checks structure before storage.
 * Prevents silent runtime failures from malformed JSON.
 */

import { ACTION_REGISTRY } from '../content/actions/index.js';
import { evaluate } from '../content/expression.js';

const CONTROL_FLOW_ACTIONS = ['loop', 'forEach', 'conditional', 'break'];
const ALL_KNOWN_ACTIONS = [...Object.keys(ACTION_REGISTRY), ...CONTROL_FLOW_ACTIONS];

const REQUIRED_FIELDS = ['id', 'version', 'name', 'urlPattern', 'steps'];

/**
 * Validate a playbook definition.
 * @param {Object} playbook
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePlaybook(playbook) {
  const errors = [];

  if (!playbook || typeof playbook !== 'object') {
    return { valid: false, errors: ['Playbook must be a non-null object'] };
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
      validateSteps(playbook.steps, errors, 'steps');
    }
  } else if (playbook.steps) {
    errors.push('"steps" must be an array');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Recursively validate step arrays.
 * @param {Object[]} steps
 * @param {string[]} errors
 * @param {string} path - For error messages
 */
function validateSteps(steps, errors, path) {
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
      if (step.steps) validateSteps(step.steps, errors, `${stepPath}.steps`);
    }
    if (step.action === 'conditional') {
      if (!step.condition) {
        errors.push(`${stepPath}: conditional requires "condition"`);
      }
      if (step.onTrue) validateSteps(step.onTrue, errors, `${stepPath}.onTrue`);
      if (step.onFalse) validateSteps(step.onFalse, errors, `${stepPath}.onFalse`);
    }
    // Bug 11: loops without a termination guard silently spin forever.
    if (step.action === 'loop') {
      if (!step.breakIf && typeof step.maxIterations !== 'number') {
        errors.push(`${stepPath}: loop requires "breakIf" expression OR "maxIterations" number`);
      }
      // Bug 16: a literal `breakIf: 'false'` (or any expression with no
      // $variables that statically evaluates to a falsy value) will never
      // break the loop. Combined with the default safetyCap=Infinity when
      // breakIf is set, that means the loop runs forever. Catch the
      // common typos here.
      if (step.breakIf && looksStaticallyFalse(step.breakIf)) {
        errors.push(`${stepPath}: breakIf "${step.breakIf}" appears to always be false — loop will never break`);
      }
    }
    if (step.action === 'forEach') {
      if (!step.items) errors.push(`${stepPath}: forEach requires "items"`);
      if (!step.itemVar) errors.push(`${stepPath}: forEach requires "itemVar"`);
    }
  }
}

/**
 * Bug 16: detect breakIf expressions that have no $variable references AND
 * statically evaluate to a falsy value. We don't reject expressions that
 * reference vars (the value depends on runtime state) and we don't reject
 * truthy literals (those break the loop on the first iteration, which is
 * weird but not infinite).
 * @param {string} expr
 * @returns {boolean}
 */
export function looksStaticallyFalse(expr) {
  if (!expr || typeof expr !== 'string') return false;
  // If expr references any $variable, can't statically evaluate.
  if (/\$\w/.test(expr)) return false;
  try {
    const result = evaluate(expr, {});
    return result === false || result === 0 || result === null || result === undefined || result === '';
  } catch {
    return false;
  }
}

const VALID_STRATEGY_TYPES = ['css', 'cssWithText', 'ariaLabel', 'textExact', 'textMatch', 'hasChild'];

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
    if (key === 'version') continue; // metadata
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
