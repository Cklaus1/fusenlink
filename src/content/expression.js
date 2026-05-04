/**
 * Safe expression evaluator for playbook conditions.
 * No eval() — uses tokenization, recursive descent parsing, and a separate
 * AST evaluator so logical operators short-circuit naturally.
 *
 * Supports:
 *   - Variable references: $varName, $settings.delayMs, $buttons.length
 *   - Comparisons: ===, !==, >=, <=, >, <
 *   - Logical: &&, ||, !
 *   - Arithmetic: +, -, %, *
 *   - Literals: numbers, strings ('...'), booleans (true/false), null, undefined
 *   - Parentheses for grouping
 */

// Token types
const T = {
  NUMBER: 'NUM',
  STRING: 'STR',
  BOOL: 'BOOL',
  NULL: 'NULL',
  UNDEFINED: 'UNDEF',
  VAR: 'VAR',
  IDENT: 'IDENT',
  OP: 'OP',
  UNARY: 'UNARY',
  LPAREN: '(',
  RPAREN: ')',
  LBRACK: '[',
  RBRACK: ']',
  DOT: '.',
  QUESTION: '?',
  COLON: ':',
  EOF: 'EOF'
};

/**
 * Tokenize an expression string.
 * @param {string} expr
 * @returns {Array<{type: string, value: any}>}
 */
function tokenize(expr) {
  const tokens = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    // Whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // Parentheses
    if (ch === '(') { tokens.push({ type: T.LPAREN, value: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: T.RPAREN, value: ')' }); i++; continue; }

    // Brackets — for member-access via [key] (Bug 26)
    if (ch === '[') { tokens.push({ type: T.LBRACK, value: '[' }); i++; continue; }
    if (ch === ']') { tokens.push({ type: T.RBRACK, value: ']' }); i++; continue; }

    // Ternary operator pieces (Bug 26)
    if (ch === '?') { tokens.push({ type: T.QUESTION, value: '?' }); i++; continue; }
    if (ch === ':') { tokens.push({ type: T.COLON, value: ':' }); i++; continue; }

    // Multi-char operators
    const two = expr.slice(i, i + 3);
    if (two === '===') { tokens.push({ type: T.OP, value: '===' }); i += 3; continue; }
    if (two === '!==') { tokens.push({ type: T.OP, value: '!==' }); i += 3; continue; }

    const pair = expr.slice(i, i + 2);
    if (pair === '!=') { tokens.push({ type: T.OP, value: '!==' }); i += 2; continue; }  // tolerate != as !==
    if (pair === '==') { tokens.push({ type: T.OP, value: '===' }); i += 2; continue; }  // tolerate == as ===
    if (pair === '&&') { tokens.push({ type: T.OP, value: '&&' }); i += 2; continue; }
    if (pair === '||') { tokens.push({ type: T.OP, value: '||' }); i += 2; continue; }
    if (pair === '>=') { tokens.push({ type: T.OP, value: '>=' }); i += 2; continue; }
    if (pair === '<=') { tokens.push({ type: T.OP, value: '<=' }); i += 2; continue; }

    // Single-char operators
    if (ch === '>') { tokens.push({ type: T.OP, value: '>' }); i++; continue; }
    if (ch === '<') { tokens.push({ type: T.OP, value: '<' }); i++; continue; }
    if (ch === '+') { tokens.push({ type: T.OP, value: '+' }); i++; continue; }
    if (ch === '-') { tokens.push({ type: T.OP, value: '-' }); i++; continue; }
    if (ch === '%') { tokens.push({ type: T.OP, value: '%' }); i++; continue; }
    if (ch === '*') { tokens.push({ type: T.OP, value: '*' }); i++; continue; }

    // Unary not
    if (ch === '!') { tokens.push({ type: T.UNARY, value: '!' }); i++; continue; }

    // String literal — single or double quotes
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let str = '';
      i++; // skip opening quote
      while (i < expr.length && expr[i] !== quote) {
        str += expr[i];
        i++;
      }
      i++; // skip closing quote
      tokens.push({ type: T.STRING, value: str });
      continue;
    }

    // Number literal — at most one decimal point
    if (/\d/.test(ch)) {
      let num = '';
      let sawDot = false;
      while (
        i < expr.length &&
        (/\d/.test(expr[i]) ||
          (expr[i] === '.' && !sawDot && /\d/.test(expr[i + 1] || '')))
      ) {
        if (expr[i] === '.') sawDot = true;
        num += expr[i];
        i++;
      }
      tokens.push({ type: T.NUMBER, value: parseFloat(num) });
      continue;
    }

    // Variable ($name.path) or keyword (true/false/null/undefined)
    if (ch === '$' || /[a-zA-Z_]/.test(ch)) {
      const isVar = ch === '$';
      let name = '';
      // Variables (starting with $) keep the dotted path syntax for back-
      // compat with resolveVarPath ($settings.delayMs). Identifiers without
      // a leading $ stop at the first non-word char so a trailing `.member`
      // becomes a separate DOT token + member ident (Bug 10).
      if (isVar) {
        while (i < expr.length && /[\w.$]/.test(expr[i])) {
          name += expr[i];
          i++;
        }
      } else {
        while (i < expr.length && /[\w$]/.test(expr[i])) {
          name += expr[i];
          i++;
        }
      }

      if (name === 'true') { tokens.push({ type: T.BOOL, value: true }); continue; }
      if (name === 'false') { tokens.push({ type: T.BOOL, value: false }); continue; }
      if (name === 'null') { tokens.push({ type: T.NULL, value: null }); continue; }
      if (name === 'undefined') { tokens.push({ type: T.UNDEFINED, value: undefined }); continue; }

      tokens.push({ type: isVar ? T.VAR : T.IDENT, value: name });
      continue;
    }

    // Standalone '.' — member access (Bug 10). Numbers are handled in the
    // numeric branch above, so reaching here means a member-access dot.
    if (ch === '.') {
      tokens.push({ type: T.DOT, value: '.' });
      i++;
      continue;
    }

    // Unknown character — report and skip
    console.warn(`Expression tokenizer: unexpected character '${expr[i]}' at position ${i}`);
    i++;
  }

  tokens.push({ type: T.EOF, value: null });
  return tokens;
}

/**
 * Recursive descent parser. Builds an AST instead of evaluating directly,
 * so the evaluator can short-circuit && and ||.
 */
class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() { return this.tokens[this.pos]; }
  advance() { return this.tokens[this.pos++]; }

  eat(type) {
    const tok = this.peek();
    if (tok.type === type) return this.advance();
    throw new Error(`Expected ${type}, got ${tok.type} (${tok.value})`);
  }

  // Entry: ternary (lowest precedence, right-associative)
  parse() {
    return this.parseTernary();
  }

  // cond ? a : b (Bug 26) — right-associative so "a ? b : c ? d : e"
  // parses as "a ? b : (c ? d : e)".
  parseTernary() {
    const test = this.parseOr();
    if (this.peek().type === T.QUESTION) {
      this.advance(); // eat ?
      const cons = this.parseTernary();
      if (this.peek().type !== T.COLON) {
        throw new Error(`Expected ':' in ternary, got ${this.peek().type} (${this.peek().value})`);
      }
      this.advance(); // eat :
      const alt = this.parseTernary();
      return { type: 'ternary', test, cons, alt };
    }
    return test;
  }

  // ||
  parseOr() {
    let left = this.parseAnd();
    while (this.peek().type === T.OP && this.peek().value === '||') {
      this.advance();
      const right = this.parseAnd();
      left = { type: 'or', left, right };
    }
    return left;
  }

  // &&
  parseAnd() {
    let left = this.parseComparison();
    while (this.peek().type === T.OP && this.peek().value === '&&') {
      this.advance();
      const right = this.parseComparison();
      left = { type: 'and', left, right };
    }
    return left;
  }

  // ===, !==, >, <, >=, <=
  parseComparison() {
    let left = this.parseAdditive();
    const compOps = ['===', '!==', '>', '<', '>=', '<='];
    while (this.peek().type === T.OP && compOps.includes(this.peek().value)) {
      const op = this.advance().value;
      const right = this.parseAdditive();
      left = { type: 'compare', op, left, right };
    }
    return left;
  }

  // +, -
  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.peek().type === T.OP && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.advance().value;
      const right = this.parseMultiplicative();
      left = { type: 'add', op, left, right };
    }
    return left;
  }

  // *, %
  parseMultiplicative() {
    let left = this.parseUnary();
    while (this.peek().type === T.OP && (this.peek().value === '*' || this.peek().value === '%')) {
      const op = this.advance().value;
      const right = this.parseUnary();
      left = { type: 'mul', op, left, right };
    }
    return left;
  }

  // ! (unary not)
  parseUnary() {
    if (this.peek().type === T.UNARY && this.peek().value === '!') {
      this.advance();
      return { type: 'not', operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  // Literals, variables, parenthesized expressions
  parsePrimary() {
    const tok = this.peek();

    let base;
    if (tok.type === T.NUMBER) { this.advance(); base = { type: 'literal', value: tok.value }; }
    else if (tok.type === T.STRING) { this.advance(); base = { type: 'literal', value: tok.value }; }
    else if (tok.type === T.BOOL) { this.advance(); base = { type: 'literal', value: tok.value }; }
    else if (tok.type === T.NULL) { this.advance(); base = { type: 'literal', value: null }; }
    else if (tok.type === T.UNDEFINED) { this.advance(); base = { type: 'literal', value: undefined }; }
    else if (tok.type === T.VAR) {
      this.advance();
      base = { type: 'var', name: tok.value };
    }
    else if (tok.type === T.IDENT) {
      // Bare identifiers (no $) — resolved via the same var lookup so
      // `vars.length`-style access still works.
      this.advance();
      base = { type: 'var', name: tok.value };
    }
    else if (tok.type === T.LPAREN) {
      this.advance(); // eat (
      base = this.parseTernary();
      this.eat(T.RPAREN); // eat )
    }
    else {
      throw new Error(`Unexpected token: ${tok.type} (${tok.value})`);
    }

    return this.parsePostfix(base);
  }

  // Bug 10: handle a chain of `[expr]` index accesses and `.member` member
  // accesses after any base expression (variable, parenthesized, etc.).
  // This is shared so e.g. `($foo)[0].name` parses the same as `$foo[0].name`.
  parsePostfix(node) {
    while (true) {
      const tok = this.peek();
      if (tok.type === T.LBRACK) {
        this.advance(); // eat [
        const key = this.parseTernary();
        if (this.peek().type !== T.RBRACK) {
          throw new Error(`Expected ']' in index expression, got ${this.peek().type} (${this.peek().value})`);
        }
        this.advance(); // eat ]
        node = { type: 'index', obj: node, key };
        continue;
      }
      if (tok.type === T.DOT) {
        this.advance(); // eat .
        const member = this.peek();
        if (member.type !== T.VAR && member.type !== T.IDENT) {
          throw new Error(`Expected member name after '.', got ${member.type} (${member.value})`);
        }
        this.advance();
        const name = String(member.value).replace(/^\$/, '');
        // member.value may itself contain dotted segments if the tokenizer
        // produced a VAR like `$foo.bar`. Split so each segment is its own
        // member node.
        const segments = name.split('.').filter(Boolean);
        for (const seg of segments) {
          node = { type: 'member', obj: node, name: seg };
        }
        continue;
      }
      break;
    }
    return node;
  }
}

/**
 * Resolve a $variable path like "$settings.delayMs" or "buttons.length"
 * against a variable context.
 * @param {string} name
 * @param {Object} vars
 * @returns {any}
 */
function resolveVarPath(name, vars) {
  const path = name.startsWith('$') ? name.slice(1) : name;
  const parts = path.split('.').filter(Boolean);

  let current = vars;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Walk an AST node and produce a value. Short-circuits && and ||
 * naturally via JS's native operators.
 * @param {Object} node
 * @param {Object} vars
 * @returns {any}
 */
function evalNode(node, vars) {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'var':
      return resolveVarPath(node.name, vars);
    case 'index': {
      // Bug 26: $obj[key] — key may be number or string.
      const obj = evalNode(node.obj, vars);
      if (obj == null) return undefined;
      const key = evalNode(node.key, vars);
      return obj[key];
    }
    case 'member': {
      // Bug 10: $obj.name member access. Null-safe so `$x.y` returns
      // undefined when x is null/undefined rather than throwing.
      const obj = evalNode(node.obj, vars);
      if (obj == null) return undefined;
      return obj[node.name];
    }
    case 'ternary':
      return evalNode(node.test, vars) ? evalNode(node.cons, vars) : evalNode(node.alt, vars);
    case 'or':
      return evalNode(node.left, vars) || evalNode(node.right, vars);
    case 'and':
      return evalNode(node.left, vars) && evalNode(node.right, vars);
    case 'not':
      return !evalNode(node.operand, vars);
    case 'compare': {
      const l = evalNode(node.left, vars);
      const r = evalNode(node.right, vars);
      switch (node.op) {
        case '===': return l === r;
        case '!==': return l !== r;
        case '>':   return l > r;
        case '<':   return l < r;
        case '>=':  return l >= r;
        case '<=':  return l <= r;
        default: throw new Error(`Unknown compare op: ${node.op}`);
      }
    }
    case 'add': {
      const l = evalNode(node.left, vars);
      const r = evalNode(node.right, vars);
      return node.op === '+' ? l + r : l - r;
    }
    case 'mul': {
      const l = evalNode(node.left, vars);
      const r = evalNode(node.right, vars);
      return node.op === '*' ? l * r : l % r;
    }
    default:
      throw new Error(`Unknown AST node type: ${node.type}`);
  }
}

/**
 * Evaluate an expression string against a set of variables.
 * @param {string} expr - The expression to evaluate
 * @param {Object} vars - Variable context (flat or nested object)
 * @returns {any} The result of the expression
 */
export function evaluate(expr, vars = {}) {
  if (typeof expr !== 'string' || expr.trim() === '') return undefined;

  try {
    const tokens = tokenize(expr);
    const parser = new Parser(tokens);
    const ast = parser.parse();
    return evalNode(ast, vars);
  } catch (err) {
    console.warn(`Expression evaluation failed for "${expr}":`, err.message);
    return undefined;
  }
}

/**
 * Resolve a single $variable reference (for non-expression contexts).
 * @param {any} value - A value that may be a $variable reference or a literal
 * @param {Object} vars - Variable context
 * @returns {any}
 */
export function resolveValue(value, vars = {}) {
  if (typeof value !== 'string') return value;
  if (!value.startsWith('$')) return value;

  const path = value.slice(1).split('.').filter(Boolean);
  let current = vars;
  for (const part of path) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}
