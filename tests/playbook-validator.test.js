/**
 * Tests for playbook validation.
 */
import { validatePlaybook } from '../src/shared/playbook-validator.js';

describe('Playbook Validator', () => {
  const validPlaybook = {
    id: 'test',
    version: 1,
    name: 'Test Playbook',
    urlPattern: 'linkedin\\.com/test/',
    steps: [
      { action: 'setVar', var: 'x', value: 0 },
      { action: 'log', message: 'Hello' }
    ]
  };

  test('accepts a valid playbook', () => {
    const { valid, errors } = validatePlaybook(validPlaybook);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  test('rejects null', () => {
    const { valid, errors } = validatePlaybook(null);
    expect(valid).toBe(false);
    expect(errors[0]).toContain('non-null object');
  });

  test('rejects missing required fields', () => {
    const { valid, errors } = validatePlaybook({ id: 'x' });
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors.some(e => e.includes('version'))).toBe(true);
    expect(errors.some(e => e.includes('name'))).toBe(true);
    expect(errors.some(e => e.includes('urlPattern'))).toBe(true);
  });

  test('rejects non-number version', () => {
    const { valid, errors } = validatePlaybook({
      ...validPlaybook,
      version: '1'
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('version'))).toBe(true);
  });

  test('rejects invalid urlPattern regex', () => {
    const { valid, errors } = validatePlaybook({
      ...validPlaybook,
      urlPattern: '([invalid'
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('urlPattern'))).toBe(true);
  });

  test('rejects invalid trustLevel', () => {
    const { valid, errors } = validatePlaybook({
      ...validPlaybook,
      trustLevel: 'yolo'
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('trustLevel'))).toBe(true);
  });

  test('rejects unknown action names', () => {
    const { valid, errors } = validatePlaybook({
      ...validPlaybook,
      steps: [{ action: 'clikc' }]
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('unknown action "clikc"'))).toBe(true);
  });

  test('rejects step without action field', () => {
    const { valid, errors } = validatePlaybook({
      ...validPlaybook,
      steps: [{ var: 'x', value: 1 }]
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('missing "action"'))).toBe(true);
  });

  test('validates nested steps in loop', () => {
    const { valid, errors } = validatePlaybook({
      ...validPlaybook,
      steps: [{
        action: 'loop',
        steps: [{ action: 'typo_action' }]
      }]
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('typo_action'))).toBe(true);
  });

  test('validates conditional requires condition', () => {
    const { valid, errors } = validatePlaybook({
      ...validPlaybook,
      steps: [{ action: 'conditional', onTrue: [] }]
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('condition'))).toBe(true);
  });

  test('validates conditional nested steps', () => {
    const { valid, errors } = validatePlaybook({
      ...validPlaybook,
      steps: [{
        action: 'conditional',
        condition: '$x > 0',
        onTrue: [{ action: 'bad_action' }]
      }]
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('bad_action'))).toBe(true);
  });

  test('validates forEach requires itemVar', () => {
    const { valid, errors } = validatePlaybook({
      ...validPlaybook,
      steps: [{
        action: 'forEach',
        items: '$list',
        steps: [{ action: 'log', message: 'hi' }]
      }]
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('itemVar'))).toBe(true);
  });

  test('accepts valid trust levels', () => {
    for (const level of ['auto', 'review', 'interactive']) {
      const { valid } = validatePlaybook({ ...validPlaybook, trustLevel: level });
      expect(valid).toBe(true);
    }
  });

  test('accepts all known action types', () => {
    const allActions = [
      'setVar', 'incrementVar', 'appendArray', 'updateProgress', 'log',
      'find', 'findAll', 'click', 'wait', 'scroll', 'scrollIntoView',
      'countElements', 'dismissModal', 'handleInviteModal', 'dismissDropdown',
      'navigateNext', 'waitForNew', 'waitForElement', 'verifyDropdown',
      'extract', 'extractAll', 'aiCall', 'storeData', 'navigate',
      'getPageContent', 'prompt', 'typeText', 'checkSecurity',
      'loop', 'forEach', 'conditional', 'break'
    ];
    const steps = allActions.map(a => ({ action: a }));
    // Need to add condition for conditional and itemVar for forEach
    steps.find(s => s.action === 'conditional').condition = 'true';
    steps.find(s => s.action === 'forEach').itemVar = 'x';

    const { valid, errors } = validatePlaybook({ ...validPlaybook, steps });
    expect(errors.filter(e => e.includes('unknown'))).toHaveLength(0);
  });
});
