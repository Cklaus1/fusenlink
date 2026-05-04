/**
 * Tests for playbook validation.
 */
import {
  validatePlaybook,
  validateSelectorRegistry,
  looksStaticallyFalse
} from '../src/shared/playbook-validator.js';
import { DEFAULT_PLAYBOOKS } from '../src/defaults/playbooks.js';
import { DEFAULT_SELECTOR_REGISTRIES } from '../src/defaults/selectors.js';
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
  // Bug 6: dropped keys are surfaced via the migration log so the UI
  // can warn the user when their tweak gets stranded.
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
      const { merged, droppedSettings } = mergePlaybookFields(shipped, stored);
      // user value preserved for `a`, shipped default kept for `b`, dead key `c` dropped
      expect(merged.settings).toEqual({ a: 99, b: 2 });
      // Bug 6: the dropped `c` is surfaced separately
      expect(droppedSettings).toEqual({ c: 3 });
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
      const { merged, droppedSettings } = mergePlaybookFields(shipped, stored);
      expect(merged.name).toBe('New Name');
      expect(merged.description).toBe('new desc');
      expect(merged.urlPattern).toBe('new');
      expect(merged.buttonLabel).toBe('New');
      expect(merged.selectors).toBe('new.key');
      expect(merged.steps).toEqual(shipped.steps);
      expect(merged.version).toBe(2);
      expect(merged.settings).toEqual({ a: 99 });
      // No keys were dropped — every stored key still exists in shipped.
      expect(droppedSettings).toEqual({});
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
      const { merged, droppedSettings } = mergePlaybookFields(shipped, stored);
      // shipped has no settings → all stored keys are "dead" → empty merged
      expect(merged.settings).toEqual({});
      // and they should ALL be reported as dropped
      expect(droppedSettings).toEqual({ ghost: 1 });
    });

    // Bug 6: the canonical scenario — shipped renames `delayMs` to
    // `delayBetweenMs`. The user's customized 2000 must not vanish silently.
    test('captures dropped keys when shipped renames a setting (delayMs → delayBetweenMs)', () => {
      const shipped = {
        id: 'pb', version: 2, name: 'n', urlPattern: 'u',
        steps: [{ action: 'log' }],
        settings: { delayBetweenMs: 1500, maxInvites: 50 }
      };
      const stored = {
        id: 'pb', version: 1, name: 'n', urlPattern: 'u',
        steps: [{ action: 'log' }],
        settings: { delayMs: 2000, maxInvites: 25 } // user customized both
      };
      const { merged, droppedSettings } = mergePlaybookFields(shipped, stored);
      // user's maxInvites=25 is preserved (key still exists)
      expect(merged.settings.maxInvites).toBe(25);
      // delayBetweenMs falls back to shipped default (no user value to copy)
      expect(merged.settings.delayBetweenMs).toBe(1500);
      // user's delayMs=2000 is dropped — but visible via droppedSettings
      expect(merged.settings.delayMs).toBeUndefined();
      expect(droppedSettings).toEqual({ delayMs: 2000 });
    });
  });

  // Bug 18: every shipped selector registry must validate.
  describe('Bug 18: validateSelectorRegistry', () => {
    test('accepts a minimal valid registry', () => {
      const registry = {
        version: 1,
        myButton: {
          strategies: [{ type: 'css', value: 'button.foo' }]
        }
      };
      const { valid, errors } = validateSelectorRegistry(registry);
      expect(valid).toBe(true);
      expect(errors).toEqual([]);
    });

    test('rejects null/non-object', () => {
      expect(validateSelectorRegistry(null).valid).toBe(false);
      expect(validateSelectorRegistry(undefined).valid).toBe(false);
      expect(validateSelectorRegistry('foo').valid).toBe(false);
    });

    test('rejects entry with non-array strategies', () => {
      const { valid, errors } = validateSelectorRegistry({
        thing: { strategies: 'not-an-array' }
      });
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('non-empty array'))).toBe(true);
    });

    test('rejects empty strategies array', () => {
      const { valid, errors } = validateSelectorRegistry({
        thing: { strategies: [] }
      });
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('non-empty array'))).toBe(true);
    });

    test('rejects strategy missing type', () => {
      const { valid, errors } = validateSelectorRegistry({
        thing: { strategies: [{ value: 'foo' }] }
      });
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('missing type'))).toBe(true);
    });

    test('rejects unknown strategy type', () => {
      const { valid, errors } = validateSelectorRegistry({
        thing: { strategies: [{ type: 'xpath', value: '//button' }] }
      });
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('unknown type "xpath"'))).toBe(true);
    });

    test('rejects css strategy missing string value', () => {
      const { valid, errors } = validateSelectorRegistry({
        thing: { strategies: [{ type: 'css' }] }
      });
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('missing value'))).toBe(true);
    });

    test('allows ariaLabel without value (uses pattern)', () => {
      const { valid, errors } = validateSelectorRegistry({
        thing: {
          strategies: [{ type: 'ariaLabel', pattern: 'connect' }]
        }
      });
      expect(valid).toBe(true);
      expect(errors).toEqual([]);
    });

    test('skips the version key', () => {
      // version is metadata, not a selector entry.
      const { valid, errors } = validateSelectorRegistry({
        version: 7,
        thing: { strategies: [{ type: 'css', value: 'a' }] }
      });
      expect(valid).toBe(true);
      expect(errors).toEqual([]);
    });

    // CI guard: every shipped registry must validate.
    for (const [key, reg] of Object.entries(DEFAULT_SELECTOR_REGISTRIES)) {
      test(`DEFAULT_SELECTOR_REGISTRIES[${key}] is valid`, () => {
        const { valid, errors } = validateSelectorRegistry(reg);
        if (!valid) {
          throw new Error(`${key} failed validation: ${errors.join('; ')}`);
        }
        expect(valid).toBe(true);
      });
    }
  });

  // Bug 16: validator detects breakIf expressions that can never be truthy.
  describe('Bug 16: looksStaticallyFalse', () => {
    test('detects literal false', () => {
      expect(looksStaticallyFalse('false')).toBe(true);
    });

    test('detects literal 0', () => {
      expect(looksStaticallyFalse('0')).toBe(true);
    });

    test('detects literal null', () => {
      expect(looksStaticallyFalse('null')).toBe(true);
    });

    test('detects empty string literal', () => {
      expect(looksStaticallyFalse("''")).toBe(true);
    });

    test('returns false for any expression with a $variable', () => {
      // can't statically evaluate something runtime-dependent
      expect(looksStaticallyFalse('$x')).toBe(false);
      expect(looksStaticallyFalse('$count > 5')).toBe(false);
      expect(looksStaticallyFalse('!$ready')).toBe(false);
    });

    test('returns false for truthy literals', () => {
      // truthy literals would break the loop on iteration 1, which is
      // weird but not infinite — not our concern here.
      expect(looksStaticallyFalse('true')).toBe(false);
      expect(looksStaticallyFalse('1')).toBe(false);
      expect(looksStaticallyFalse("'something'")).toBe(false);
    });

    test('returns false for non-string input', () => {
      expect(looksStaticallyFalse(null)).toBe(false);
      expect(looksStaticallyFalse(undefined)).toBe(false);
      expect(looksStaticallyFalse('')).toBe(false);
      expect(looksStaticallyFalse(42)).toBe(false);
    });

    test('rejects loop with breakIf:"false" via validatePlaybook', () => {
      const { valid, errors } = validatePlaybook({
        ...validPlaybook,
        steps: [{
          action: 'loop',
          breakIf: 'false',
          steps: [{ action: 'log', message: 'spin' }]
        }]
      });
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('never break'))).toBe(true);
    });

    test('accepts loop with a $variable-driven breakIf', () => {
      const { valid, errors } = validatePlaybook({
        ...validPlaybook,
        steps: [{
          action: 'loop',
          breakIf: '$x > 5',
          steps: [{ action: 'log', message: 'ok' }]
        }]
      });
      expect(valid).toBe(true);
      expect(errors).toEqual([]);
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
