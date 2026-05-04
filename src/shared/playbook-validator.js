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
    if (step.action === 'forEach' && !step.itemVar) {
      errors.push(`${stepPath}: forEach requires "itemVar"`);
    }
  }
}
