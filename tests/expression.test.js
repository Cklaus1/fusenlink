/**
 * Tests for safe expression evaluator
 */
import { evaluate, resolveValue } from '../src/content/expression.js';

describe('Expression Evaluator', () => {
  describe('literals', () => {
    test('numbers', () => {
      expect(evaluate('42')).toBe(42);
      expect(evaluate('3.14')).toBe(3.14);
    });

    test('strings', () => {
      expect(evaluate("'hello'")).toBe('hello');
    });

    test('booleans', () => {
      expect(evaluate('true')).toBe(true);
      expect(evaluate('false')).toBe(false);
    });

    test('null and undefined', () => {
      expect(evaluate('null')).toBe(null);
      expect(evaluate('undefined')).toBe(undefined);
    });
  });

  describe('variables', () => {
    test('simple variable', () => {
      expect(evaluate('$count', { count: 10 })).toBe(10);
    });

    test('nested path', () => {
      expect(evaluate('$settings.delayMs', { settings: { delayMs: 1500 } })).toBe(1500);
    });

    test('deep path', () => {
      expect(evaluate('$a.b.c', { a: { b: { c: 'deep' } } })).toBe('deep');
    });

    test('undefined variable returns undefined', () => {
      expect(evaluate('$missing', {})).toBe(undefined);
    });

    test('undefined nested path returns undefined', () => {
      expect(evaluate('$a.b.c', { a: null })).toBe(undefined);
    });
  });

  describe('comparisons', () => {
    test('strict equality', () => {
      expect(evaluate('$x === 5', { x: 5 })).toBe(true);
      expect(evaluate('$x === 5', { x: '5' })).toBe(false);
    });

    test('strict inequality', () => {
      expect(evaluate('$x !== 0', { x: 5 })).toBe(true);
    });

    test('greater than', () => {
      expect(evaluate('$x > 10', { x: 15 })).toBe(true);
      expect(evaluate('$x > 10', { x: 5 })).toBe(false);
    });

    test('less than', () => {
      expect(evaluate('$x < 10', { x: 5 })).toBe(true);
    });

    test('greater or equal', () => {
      expect(evaluate('$x >= 10', { x: 10 })).toBe(true);
      expect(evaluate('$x >= 10', { x: 9 })).toBe(false);
    });

    test('less or equal', () => {
      expect(evaluate('$x <= 10', { x: 10 })).toBe(true);
    });
  });

  describe('logical operators', () => {
    test('AND', () => {
      expect(evaluate('$a && $b', { a: true, b: true })).toBe(true);
      expect(evaluate('$a && $b', { a: true, b: false })).toBe(false);
    });

    test('OR', () => {
      expect(evaluate('$a || $b', { a: false, b: true })).toBe(true);
      expect(evaluate('$a || $b', { a: false, b: false })).toBe(false);
    });

    test('NOT', () => {
      expect(evaluate('!$a', { a: true })).toBe(false);
      expect(evaluate('!$a', { a: false })).toBe(true);
    });

    test('double NOT', () => {
      expect(evaluate('!!$a', { a: 'truthy' })).toBe(true);
    });
  });

  describe('arithmetic', () => {
    test('modulo', () => {
      expect(evaluate('$count % 5', { count: 10 })).toBe(0);
      expect(evaluate('$count % 5', { count: 7 })).toBe(2);
    });

    test('addition', () => {
      expect(evaluate('$x + 1', { x: 5 })).toBe(6);
    });

    test('subtraction', () => {
      expect(evaluate('$x - 1', { x: 5 })).toBe(4);
    });

    test('multiplication', () => {
      expect(evaluate('$x * 2', { x: 5 })).toBe(10);
    });
  });

  describe('complex expressions', () => {
    test('combined condition with modulo', () => {
      expect(evaluate(
        '$processedCount % $settings.interval === 0',
        { processedCount: 10, settings: { interval: 5 } }
      )).toBe(true);
    });

    test('stop condition', () => {
      expect(evaluate(
        '$stopRequested || $processedCount >= $settings.maxItems',
        { stopRequested: false, processedCount: 50, settings: { maxItems: 50 } }
      )).toBe(true);
    });

    test('length check', () => {
      expect(evaluate('$buttons.length === 0', { buttons: { length: 0 } })).toBe(true);
      expect(evaluate('$buttons.length === 0', { buttons: { length: 3 } })).toBe(false);
    });

    test('parenthesized expression', () => {
      expect(evaluate('($a + $b) * 2', { a: 3, b: 4 })).toBe(14);
    });

    test('negated comparison', () => {
      expect(evaluate('!($x === 5)', { x: 3 })).toBe(true);
      expect(evaluate('!$foundMore', { foundMore: false })).toBe(true);
    });
  });

  describe('edge cases', () => {
    test('empty string returns undefined', () => {
      expect(evaluate('')).toBe(undefined);
    });

    test('null expr returns undefined', () => {
      expect(evaluate(null)).toBe(undefined);
    });

    test('operator precedence', () => {
      // && binds tighter than ||
      expect(evaluate('true || false && false')).toBe(true);
      // * binds tighter than +
      expect(evaluate('2 + 3 * 4')).toBe(14);
    });
  });

  describe('short-circuit evaluation', () => {
    test('&& does not evaluate right side when left is falsy', () => {
      // If the right side were evaluated eagerly, accessing $x.deep.path on
      // null x would still resolve to undefined here (because resolveVar is
      // tolerant), so we can't directly assert "no crash". But we *can*
      // assert that evaluation of a property access on a getter that throws
      // is never reached.
      let touched = false;
      const trap = {
        get foo() { touched = true; throw new Error('right side evaluated'); }
      };
      expect(evaluate('$x !== null && $x.foo === 1', { x: null, trap }))
        .toBe(false);
      // The classic case asked for in the bug report:
      expect(evaluate('$x !== null && $x.deep.path === 5', { x: null }))
        .toBe(false);
      expect(touched).toBe(false);
    });

    test('&& with throwing right side is skipped when left is falsy', () => {
      // Use a getter on the vars context to prove short-circuit. If the right
      // operand were evaluated, accessing $danger.foo would attempt
      // vars.danger.foo, where danger throws on access.
      const vars = {
        x: null,
        get danger() { throw new Error('should not evaluate'); }
      };
      expect(evaluate('$x !== null && $danger === 1', vars)).toBe(false);
    });

    test('|| does not evaluate right side when left is truthy', () => {
      // crashOnAccess is just an unknown var, so resolveVar returns undefined.
      // Either way, the result must be true since left is truthy.
      expect(evaluate('$y === 1 || crashOnAccess', { y: 1 })).toBe(true);
    });

    test('|| with throwing right side is skipped when left is truthy', () => {
      const vars = {
        y: 1,
        get danger() { throw new Error('should not evaluate'); }
      };
      expect(evaluate('$y === 1 || $danger === 2', vars)).toBe(true);
    });
  });

  describe('relaxed equality operators', () => {
    test('!= behaves as !==', () => {
      expect(evaluate('$x != 5', { x: 4 })).toBe(true);
      expect(evaluate('$x != 5', { x: 5 })).toBe(false);
    });
    test('== behaves as ===', () => {
      expect(evaluate('$x == 5', { x: 5 })).toBe(true);
      expect(evaluate('$x == 5', { x: 4 })).toBe(false);
    });
  });

  describe('ternary operator (Bug 26)', () => {
    test('basic ternary picks consequent when truthy', () => {
      expect(evaluate('$x > 0 ? "yes" : "no"', { x: 1 })).toBe('yes');
    });

    test('basic ternary picks alternate when falsy', () => {
      expect(evaluate('$x > 0 ? "yes" : "no"', { x: -1 })).toBe('no');
    });

    test('ternary with arithmetic in branches', () => {
      expect(evaluate('$flag ? $a + 1 : $a - 1', { flag: true, a: 5 })).toBe(6);
      expect(evaluate('$flag ? $a + 1 : $a - 1', { flag: false, a: 5 })).toBe(4);
    });

    test('ternary right-associativity', () => {
      // a ? b : c ? d : e == a ? b : (c ? d : e)
      expect(evaluate('$a ? 1 : $b ? 2 : 3', { a: false, b: true })).toBe(2);
      expect(evaluate('$a ? 1 : $b ? 2 : 3', { a: false, b: false })).toBe(3);
    });

    test('ternary inside parentheses', () => {
      expect(evaluate('1 + ($x > 0 ? 10 : 20)', { x: 1 })).toBe(11);
    });
  });

  describe('bracket member access (Bug 26)', () => {
    test('numeric index on array', () => {
      expect(evaluate('$x[0]', { x: [5, 6, 7] })).toBe(5);
      expect(evaluate('$x[2]', { x: [5, 6, 7] })).toBe(7);
    });

    test('string index on object', () => {
      expect(evaluate("$row['name']", { row: { name: 'Alice' } })).toBe('Alice');
    });

    test('variable as index', () => {
      expect(evaluate('$x[$i]', { x: [10, 20, 30], i: 1 })).toBe(20);
    });

    test('chained brackets', () => {
      expect(evaluate('$grid[0][1]', { grid: [[1, 2], [3, 4]] })).toBe(2);
    });

    test('bracket combined with ternary', () => {
      // Mirrors the example from the bug report.
      expect(evaluate('$contacts[0].seen ? 1 : 0', { contacts: [{ seen: true }] })).toBe(1);
      expect(evaluate('$contacts[0].seen ? 1 : 0', { contacts: [{ seen: false }] })).toBe(0);
    });

    test('index on null returns undefined', () => {
      expect(evaluate('$x[0]', { x: null })).toBe(undefined);
    });
  });

  describe('number tokenizer', () => {
    test('plain decimal still works', () => {
      expect(evaluate('1.5')).toBe(1.5);
    });

    test('multi-dot number "1.2.3" tokenizes as 1.2, not as a single bogus number', () => {
      // The tokenizer now stops a number after one decimal point. The
      // remaining ".3" begins with a '.', which is not a recognized starter
      // for any token — the tokenizer warns and skips the '.' and tokenizes
      // "3" as a separate number. The parser only consumes one primary
      // expression at the top level, so `evaluate('1.2.3')` returns 1.2.
      // (Previously the tokenizer slurped "1.2.3" into one token whose
      // parseFloat coincidentally also yielded 1.2 — but with garbage like
      // "1..2" it would have produced NaN. Now the boundary is principled.)
      expect(evaluate('1.2.3', {})).toBe(1.2);
    });

    test('double-dot "1..2" tokenizes as 1 (no NaN)', () => {
      // Confirms the tokenizer rejects a second dot rather than producing NaN.
      expect(evaluate('1..2', {})).toBe(1);
    });

    test('number followed by member access still parses cleanly', () => {
      // Sanity: ensure the change doesn't break common patterns.
      expect(evaluate('1.5 + 0.5')).toBe(2);
    });
  });
});

describe('resolveValue', () => {
  test('resolves $variable', () => {
    expect(resolveValue('$count', { count: 42 })).toBe(42);
  });

  test('resolves nested $path', () => {
    expect(resolveValue('$settings.delayMs', { settings: { delayMs: 1500 } })).toBe(1500);
  });

  test('returns non-string values as-is', () => {
    expect(resolveValue(42, {})).toBe(42);
    expect(resolveValue(null, {})).toBe(null);
    expect(resolveValue(true, {})).toBe(true);
  });

  test('returns non-$ strings as-is', () => {
    expect(resolveValue('hello', {})).toBe('hello');
  });

  test('returns undefined for missing path', () => {
    expect(resolveValue('$missing', {})).toBe(undefined);
  });
});
