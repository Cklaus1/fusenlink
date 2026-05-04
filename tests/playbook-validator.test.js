/**
 * Tests for playbook validation.
 */
import { validatePlaybook } from '../src/shared/playbook-validator.js';
import { DEFAULT_PLAYBOOKS } from '../src/defaults/playbooks.js';
import { mergePlaybookFields } from '../src/background/playbook-store.js';

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

  describe('Bug 11: control-flow termination guards', () => {
    test('rejects loop without breakIf or maxIterations', () => {
      const { valid, errors } = validatePlaybook({
        ...validPlaybook,
        steps: [{
          action: 'loop',
          steps: [{ action: 'log', message: 'spin' }]
        }]
      });
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('breakIf') && e.includes('maxIterations'))).toBe(true);
    });

    test('accepts loop with only breakIf', () => {
      const { valid, errors } = validatePlaybook({
        ...validPlaybook,
        steps: [{
          action: 'loop',
          breakIf: '$x > 5',
          steps: [{ action: 'log', message: 'ok' }]
        }]
      });
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });

    test('accepts loop with only maxIterations', () => {
      const { valid, errors } = validatePlaybook({
        ...validPlaybook,
        steps: [{
          action: 'loop',
          maxIterations: 100,
          steps: [{ action: 'log', message: 'ok' }]
        }]
      });
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });

    test('rejects loop with non-numeric maxIterations and no breakIf', () => {
      const { valid, errors } = validatePlaybook({
        ...validPlaybook,
        steps: [{
          action: 'loop',
          maxIterations: 'lots',
          steps: [{ action: 'log', message: 'spin' }]
        }]
      });
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('breakIf') || e.includes('maxIterations'))).toBe(true);
    });

    test('rejects forEach without items', () => {
      const { valid, errors } = validatePlaybook({
        ...validPlaybook,
        steps: [{
          action: 'forEach',
          itemVar: 'x',
          steps: [{ action: 'log', message: 'hi' }]
        }]
      });
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('items'))).toBe(true);
    });

    test('forEach without items AND without itemVar reports both', () => {
      const { valid, errors } = validatePlaybook({
        ...validPlaybook,
        steps: [{
          action: 'forEach',
          steps: [{ action: 'log', message: 'hi' }]
        }]
      });
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('items'))).toBe(true);
      expect(errors.some(e => e.includes('itemVar'))).toBe(true);
    });

    test('accepts forEach with items and itemVar', () => {
      const { valid, errors } = validatePlaybook({
        ...validPlaybook,
        steps: [{
          action: 'forEach',
          items: '$list',
          itemVar: 'item',
          steps: [{ action: 'log', message: 'hi' }]
        }]
      });
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });
  });

  test('accepts valid trust levels', () => {
    for (const level of ['auto', 'review', 'interactive']) {
      const { valid } = validatePlaybook({ ...validPlaybook, trustLevel: level });
      expect(valid).toBe(true);
    }
  });

  // Bug 35: CI guard — every shipped default must pass validation.
  describe('Bug 35: shipped defaults pass validation', () => {
    for (const [id, pb] of Object.entries(DEFAULT_PLAYBOOKS)) {
      test(`DEFAULT_PLAYBOOKS[${id}] is valid`, () => {
        const { valid, errors } = validatePlaybook(pb);
        if (!valid) {
          // Surface the errors in the assertion message so CI shows what broke.
          throw new Error(`${id} failed validation: ${errors.join('; ')}`);
        }
        expect(valid).toBe(true);
      });
    }
  });

  // Bug 4: per-field merge preserves user `settings` customizations on
  // version bump while dropping settings keys removed in shipped.
  describe('Bug 4: mergePlaybookFields', () => {
    test('preserves user settings for keys that still exist in shipped', () => {
      const shipped = {
        id: 'pb',
        version: 2,
        name: 'New Name',
        urlPattern: 'foo',
        steps: [{ action: 'log', message: 'new' }],
        settings: { a: 1, b: 2 }
      };
      const stored = {
        id: 'pb',
        version: 1,
        name: 'Old Name',
        urlPattern: 'old',
        steps: [{ action: 'log', message: 'old' }],
        settings: { a: 99, c: 3 }
      };
      const merged = mergePlaybookFields(shipped, stored);
      // user value preserved for `a`, shipped default kept for `b`, dead key `c` dropped
      expect(merged.settings).toEqual({ a: 99, b: 2 });
    });

    test('replaces ship-controlled fields with shipped values', () => {
      const shipped = {
        id: 'pb',
        version: 2,
        name: 'New Name',
        description: 'new desc',
        urlPattern: 'new',
        buttonLabel: 'New',
        selectors: 'new.key',
        steps: [{ action: 'log', message: 'new' }],
        settings: { a: 1 }
      };
      const stored = {
        id: 'pb',
        version: 1,
        name: 'Old Name',
        description: 'old desc',
        urlPattern: 'old',
        buttonLabel: 'Old',
        selectors: 'old.key',
        steps: [{ action: 'log', message: 'old' }],
        settings: { a: 99 }
      };
      const merged = mergePlaybookFields(shipped, stored);
      expect(merged.name).toBe('New Name');
      expect(merged.description).toBe('new desc');
      expect(merged.urlPattern).toBe('new');
      expect(merged.buttonLabel).toBe('New');
      expect(merged.selectors).toBe('new.key');
      expect(merged.steps).toEqual(shipped.steps);
      expect(merged.version).toBe(2);
      expect(merged.settings).toEqual({ a: 99 });
    });

    test('handles missing settings on either side', () => {
      const shipped = {
        id: 'pb', version: 2, name: 'n', urlPattern: 'u',
        steps: [{ action: 'log' }]
      };
      const stored = {
        id: 'pb', version: 1, name: 'old', urlPattern: 'old',
        steps: [{ action: 'log' }], settings: { ghost: 1 }
      };
      const merged = mergePlaybookFields(shipped, stored);
      // shipped has no settings → all stored keys are "dead" → empty
      expect(merged.settings).toEqual({});
    });
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
    // Need to add required fields per control-flow action.
    steps.find(s => s.action === 'conditional').condition = 'true';
    const fe = steps.find(s => s.action === 'forEach');
    fe.itemVar = 'x';
    fe.items = '$list';
    steps.find(s => s.action === 'loop').maxIterations = 1;

    const { valid, errors } = validatePlaybook({ ...validPlaybook, steps });
    expect(errors.filter(e => e.includes('unknown'))).toHaveLength(0);
  });
});
