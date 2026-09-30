/*
 * JSONPath (RFC 9535) — a complete parser and evaluator, plus JSON Pointer (RFC 6901) lookups.
 *
 * Queries run over parsed JSON values; RawNumbers (exact number literals) compare by exact value.
 * `match()` and `search()` take I-Regexp patterns (RFC 9485), translated to ECMAScript regexes.
 */
import { compareCodePoints, compareNumbers, isContainer, isNumber, numberKey, RawNumber } from '../utils/json';

export class JsonPathError extends Error {
  constructor(message, position) {
    super(position === undefined ? message : `${message} (at position ${position + 1})`);
    this.name = 'JsonPathError';
    this.position = position;
  }
}

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value) => isContainer(value) && !Array.isArray(value);
const NOTHING = Symbol('nothing');
/**
 * What a `conceal` option (see compileJsonPath) returns in place of a value that filters must not
 * read. On its own it acts as if the value were not there; inside an object or array it equals
 * nothing but another concealed value.
 */
export const CONCEALED = Symbol('concealed');
// Integers in JSONPath must be exactly representable (I-JSON): ±(2^53 − 1).
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

const FUNCTIONS = {
  length: { params: ['value'], result: 'value' },
  count: { params: ['nodes'], result: 'value' },
  match: { params: ['value', 'value'], result: 'logical' },
  search: { params: ['value', 'value'], result: 'logical' },
  value: { params: ['nodes'], result: 'value' },
};

const BLANKS = new Set([' ', '\t', '\n', '\r']);
const isDigit = (char) => char >= '0' && char <= '9';
const isAlpha = (char) => (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');

function isNameFirst(char) {
  if (char === undefined) return false;
  if (isAlpha(char) || char === '_') return true;
  const code = char.codePointAt(0);
  return (code >= 0x80 && code <= 0xd7ff) || code >= 0xe000;
}

/* ─── Parser ─── */

class Parser {
  constructor(text) {
    this.text = text;
    this.pos = 0;
  }

  fail(message, position = this.pos) {
    throw new JsonPathError(`Invalid JSONPath: ${message}`, position);
  }

  get char() {
    return this.text[this.pos];
  }

  skipBlank() {
    while (BLANKS.has(this.text[this.pos])) this.pos += 1;
  }

  eat(token) {
    if (!this.text.startsWith(token, this.pos)) return false;
    this.pos += token.length;
    return true;
  }

  expect(token, what = `'${token}'`) {
    if (!this.eat(token)) this.fail(`expected ${what}${this.pos >= this.text.length ? ' but the expression ended' : ''}`);
  }

  parseQueryRoot() {
    if (this.char !== '$') this.fail("a query must start with '$'");
    this.pos += 1;
    const segments = this.parseSegments();
    if (this.pos < this.text.length) this.fail(`unexpected '${this.text[this.pos]}'`);
    return { root: '$', segments };
  }

  parseSegments() {
    const segments = [];
    for (;;) {
      const start = this.pos;
      this.skipBlank();
      if (this.eat('..')) {
        segments.push({ descendant: true, selectors: this.parseDescendantSelectors() });
      } else if (this.char === '.') {
        this.pos += 1;
        segments.push({ descendant: false, selectors: [this.parseShorthand()] });
      } else if (this.char === '[') {
        segments.push({ descendant: false, selectors: this.parseBracketed() });
      } else {
        this.pos = start;
        return segments;
      }
    }
  }

  parseDescendantSelectors() {
    if (this.char === '[') return this.parseBracketed();
    return [this.parseShorthand()];
  }

  parseShorthand() {
    if (this.char === '*') {
      this.pos += 1;
      return { type: 'wildcard' };
    }
    const start = this.pos;
    const first = String.fromCodePoint(this.text.codePointAt(this.pos) ?? 0);
    if (!isNameFirst(this.char === undefined ? undefined : first)) this.fail('expected a member name or * after the dot');
    this.pos += first.length;
    for (;;) {
      const char = this.text[this.pos];
      if (char === undefined) break;
      const full = String.fromCodePoint(this.text.codePointAt(this.pos));
      if (!isNameFirst(full) && !isDigit(char)) break;
      this.pos += full.length;
    }
    return { type: 'name', name: this.text.slice(start, this.pos) };
  }

  parseBracketed() {
    this.expect('[');
    this.skipBlank();
    const selectors = [this.parseSelector()];
    for (;;) {
      this.skipBlank();
      if (!this.eat(',')) break;
      this.skipBlank();
      selectors.push(this.parseSelector());
    }
    this.skipBlank();
    this.expect(']', "']' to close the selector");
    return selectors;
  }

  parseSelector() {
    const char = this.char;
    if (char === "'" || char === '"') return { type: 'name', name: this.parseString() };
    if (char === '*') {
      this.pos += 1;
      return { type: 'wildcard' };
    }
    if (char === '?') {
      this.pos += 1;
      this.skipBlank();
      return { type: 'filter', expression: this.parseLogicalOr() };
    }
    return this.parseIndexOrSlice();
  }

  parseInteger() {
    const start = this.pos;
    this.eat('-');
    if (!isDigit(this.char)) this.fail('expected an integer', start);
    if (this.char === '0' && this.pos === start + 1) this.fail("'-0' is not a valid index", start);
    if (this.char === '0' && isDigit(this.text[this.pos + 1])) this.fail('integers cannot have leading zeros', start);
    while (isDigit(this.char)) this.pos += 1;
    const value = Number(this.text.slice(start, this.pos));
    if (Math.abs(value) > MAX_SAFE) this.fail('integer is outside the supported range', start);
    return value;
  }

  parseIndexOrSlice() {
    const start = this.pos;
    let first = null;
    if (this.char === '-' || isDigit(this.char)) first = this.parseInteger();
    const beforeColon = this.pos;
    this.skipBlank();
    if (this.char !== ':') {
      this.pos = beforeColon;
      if (first === null) this.fail('expected a selector (name, *, index, slice or filter)', start);
      return { type: 'index', index: first };
    }
    this.pos += 1;
    this.skipBlank();
    let end = null;
    let step = null;
    if (this.char === '-' || isDigit(this.char)) {
      end = this.parseInteger();
      this.skipBlank();
    }
    if (this.eat(':')) {
      this.skipBlank();
      if (this.char === '-' || isDigit(this.char)) step = this.parseInteger();
    }
    return { type: 'slice', start: first, end, step };
  }

  parseString() {
    const quote = this.char;
    const start = this.pos;
    this.pos += 1;
    let result = '';
    for (;;) {
      const char = this.text[this.pos];
      if (char === undefined) this.fail('unterminated string', start);
      if (char === quote) {
        this.pos += 1;
        return result;
      }
      if (char === '\\') {
        result += this.parseEscape(quote);
        continue;
      }
      const code = char.charCodeAt(0);
      if (code < 0x20) this.fail('control characters must be escaped in strings');
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = this.text.charCodeAt(this.pos + 1);
        if (!(low >= 0xdc00 && low <= 0xdfff)) this.fail('lone surrogate in a string');
        result += this.text.slice(this.pos, this.pos + 2);
        this.pos += 2;
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) this.fail('lone surrogate in a string');
      result += char;
      this.pos += 1;
    }
  }

  parseEscape(quote) {
    const start = this.pos;
    const char = this.text[this.pos + 1];
    this.pos += 2;
    switch (char) {
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '/':
        return '/';
      case '\\':
        return '\\';
      case 'u': {
        const high = this.parseHex4(start);
        if (high >= 0xdc00 && high <= 0xdfff) this.fail('lone low surrogate escape', start);
        if (high < 0xd800 || high > 0xdbff) return String.fromCharCode(high);
        if (!this.eat('\\u')) this.fail('a high surrogate escape must be followed by a low surrogate', start);
        const low = this.parseHex4(start);
        if (!(low >= 0xdc00 && low <= 0xdfff)) this.fail('a high surrogate escape must be followed by a low surrogate', start);
        return String.fromCharCode(high, low);
      }
      default:
        if (char === quote) return quote;
        return this.fail(`invalid escape '\\${char ?? ''}'`, start);
    }
  }

  parseHex4(start) {
    const hex = this.text.slice(this.pos, this.pos + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('invalid \\u escape', start);
    this.pos += 4;
    return parseInt(hex, 16);
  }

  /* Filters */

  parseLogicalOr(first) {
    const items = [this.parseLogicalAnd(first)];
    for (;;) {
      const save = this.pos;
      this.skipBlank();
      if (!this.eat('||')) {
        this.pos = save;
        break;
      }
      this.skipBlank();
      items.push(this.parseLogicalAnd());
    }
    return items.length === 1 ? items[0] : { type: 'or', items };
  }

  parseLogicalAnd(first) {
    const items = [first ?? this.parseBasic()];
    for (;;) {
      const save = this.pos;
      this.skipBlank();
      if (!this.eat('&&')) {
        this.pos = save;
        break;
      }
      this.skipBlank();
      items.push(this.parseBasic());
    }
    return items.length === 1 ? items[0] : { type: 'and', items };
  }

  parseBasic() {
    if (this.char === '!') {
      const start = this.pos;
      this.pos += 1;
      this.skipBlank();
      if (this.char === '(') return { type: 'not', expression: this.parseParenthesized() };
      const operand = this.parseOperand();
      return { type: 'not', expression: this.toTest(operand, start) };
    }
    if (this.char === '(') return this.parseParenthesized();
    const start = this.pos;
    const operand = this.parseOperand();
    return this.completeComparison(operand, start) ?? this.toTest(operand, start);
  }

  parseParenthesized() {
    this.expect('(');
    this.skipBlank();
    const expression = this.parseLogicalOr();
    this.skipBlank();
    this.expect(')', "')'");
    return expression;
  }

  /** Turns `operand <op> operand` into a comparison, or returns null when no operator follows. */
  completeComparison(left, start) {
    const save = this.pos;
    this.skipBlank();
    const op = ['==', '!=', '<=', '>=', '<', '>'].find((candidate) => this.text.startsWith(candidate, this.pos));
    if (!op) {
      this.pos = save;
      return null;
    }
    this.pos += op.length;
    this.skipBlank();
    const rightStart = this.pos;
    const right = this.parseOperand();
    this.checkComparable(left, start);
    this.checkComparable(right, rightStart);
    return { type: 'compare', op, left, right };
  }

  checkComparable(operand, position) {
    if (operand.type === 'query' && !operand.singular) this.fail('only singular queries (no wildcards, slices, filters or ..) can be compared', position);
    if (operand.type === 'function' && FUNCTIONS[operand.name].result !== 'value') this.fail(`${operand.name}() does not return a value to compare`, position);
  }

  toTest(operand, position) {
    if (operand.type === 'literal') this.fail('a literal cannot be used on its own as a filter', position);
    if (operand.type === 'function' && FUNCTIONS[operand.name].result === 'value') {
      this.fail(`${operand.name}() returns a value; compare it with something`, position);
    }
    return { type: 'test', operand };
  }

  parseOperand() {
    const char = this.char;
    if (char === '$' || char === '@') {
      this.pos += 1;
      const segments = this.parseSegments();
      const singular = segments.every((segment) => !segment.descendant && segment.selectors.length === 1 && ['name', 'index'].includes(segment.selectors[0].type));
      return { type: 'query', root: char, segments, singular };
    }
    if (char === "'" || char === '"') return { type: 'literal', value: this.parseString() };
    if (char === '-' || isDigit(char)) return { type: 'literal', value: this.parseNumber() };
    if (char >= 'a' && char <= 'z') {
      const start = this.pos;
      while (/[a-z0-9_]/.test(this.char ?? '')) this.pos += 1;
      const word = this.text.slice(start, this.pos);
      if (this.char === '(') return this.parseFunction(word, start);
      if (word === 'true') return { type: 'literal', value: true };
      if (word === 'false') return { type: 'literal', value: false };
      if (word === 'null') return { type: 'literal', value: null };
      return this.fail(`unknown name '${word}'`, start);
    }
    return this.fail(char === undefined ? 'the filter ended unexpectedly' : `unexpected '${char}' in a filter`);
  }

  parseNumber() {
    const start = this.pos;
    this.eat('-');
    if (!isDigit(this.char)) this.fail('invalid number', start);
    if (this.char === '0' && isDigit(this.text[this.pos + 1])) this.fail('numbers cannot have leading zeros', start);
    while (isDigit(this.char)) this.pos += 1;
    if (this.eat('.')) {
      if (!isDigit(this.char)) this.fail('invalid number', start);
      while (isDigit(this.char)) this.pos += 1;
    }
    if (this.char === 'e' || this.char === 'E') {
      this.pos += 1;
      if (this.char === '+' || this.char === '-') this.pos += 1;
      if (!isDigit(this.char)) this.fail('invalid number', start);
      while (isDigit(this.char)) this.pos += 1;
    }
    return new RawNumber(this.text.slice(start, this.pos));
  }

  parseFunction(name, start) {
    const signature = FUNCTIONS[name];
    if (!signature) this.fail(`unknown function '${name}()'`, start);
    this.expect('(');
    this.skipBlank();
    const args = [];
    if (this.char !== ')') {
      for (;;) {
        const argStart = this.pos;
        args.push({ node: this.parseArgument(), position: argStart });
        this.skipBlank();
        if (!this.eat(',')) break;
        this.skipBlank();
      }
    }
    this.skipBlank();
    this.expect(')', "')' to close the function call");
    if (args.length !== signature.params.length) {
      this.fail(`${name}() takes ${signature.params.length} argument${signature.params.length === 1 ? '' : 's'}`, start);
    }
    args.forEach((arg, index) => this.checkArgument(name, signature.params[index], arg));
    return { type: 'function', name, args: args.map((arg) => arg.node) };
  }

  /** An argument is a literal, a query, a function call or a whole logical expression. */
  parseArgument() {
    if (this.char === '!' || this.char === '(') return this.parseLogicalOr();
    const start = this.pos;
    const operand = this.parseOperand();
    const comparison = this.completeComparison(operand, start);
    const save = this.pos;
    this.skipBlank();
    const continues = this.text.startsWith('&&', this.pos) || this.text.startsWith('||', this.pos);
    this.pos = save;
    if (!comparison && !continues) return operand;
    return this.parseLogicalOr(comparison ?? this.toTest(operand, start));
  }

  checkArgument(name, param, { node, position }) {
    const kind =
      node.type === 'literal'
        ? 'value'
        : node.type === 'query'
          ? node.singular
            ? 'singular'
            : 'nodes'
          : node.type === 'function'
            ? FUNCTIONS[node.name].result
            : 'logical';
    // Parameters are values or node lists (see FUNCTIONS); a singular query can be either.
    const accepted = kind === 'singular' || kind === (param === 'value' ? 'value' : 'nodes');
    if (!accepted) this.fail(`wrong kind of argument for ${name}()`, position);
  }
}

/* ─── I-Regexp (RFC 9485) → ECMAScript ─── */

const regexCache = new Map();
const CATEGORY = /^(L[lmotu]?|M[cen]?|N[dlo]?|P[cdefios]?|Z[lps]?|S[ckmo]?|C[cfno]?)$/;
const SINGLE_ESCAPES = new Set(['(', ')', '*', '+', '-', '.', '?', '[', '\\', ']', '^', 'n', 'r', 't', '{', '|', '}']);

/*
 * One character that is not in a class: a negative lookahead, then any character. The translation
 * never emits a negated class such as [^x], because Node 18's regular expression engine fails to
 * match a character outside the Basic Multilingual Plane (an emoji, say) with one in unicode mode.
 */
const notIn = (body) => `(?:(?![${body.startsWith('^') ? `\\${body}` : body}])[\\s\\S])`;

/** Translates an I-Regexp into ECMAScript source, or returns null when it is not a valid I-Regexp. */
export function translateIRegexp(pattern) {
  let pos = 0;
  const peek = () => pattern[pos];

  const escape = (inClass) => {
    pos += 1;
    const char = pattern[pos];
    if (char === 'p' || char === 'P') {
      const close = pattern.indexOf('}', pos);
      if (pattern[pos + 1] !== '{' || close === -1) return null;
      const category = pattern.slice(pos + 2, close);
      if (!CATEGORY.test(category)) return null;
      pos = close + 1;
      return `\\${char}{${category}}`;
    }
    if (!SINGLE_ESCAPES.has(char)) return null;
    pos += 1;
    if (char === 'n' || char === 'r' || char === 't') return `\\${char}`;
    // ECMAScript's unicode mode only allows escaping syntax characters ('-' just inside classes).
    if (char === '-') return inClass ? '\\-' : '-';
    return `\\${char}`;
  };

  const charClass = () => {
    pos += 1;
    const negated = peek() === '^';
    if (negated) pos += 1;
    let body = '';
    let count = 0;
    let previousWasChar = false;
    for (;;) {
      const char = peek();
      if (char === undefined) return null;
      if (char === ']' && count > 0) {
        pos += 1;
        return negated ? notIn(body) : `[${body}]`;
      }
      if (char === '[' || (char === ']' && count === 0)) return null;
      if (char === '-') {
        // Allowed first, last, or between two range endpoints.
        const next = pattern[pos + 1];
        if (count === 0 || next === ']') {
          body += '\\-';
          pos += 1;
          count += 1;
          previousWasChar = false;
          continue;
        }
        if (!previousWasChar) return null;
        pos += 1;
        let end;
        if (pattern[pos] === '\\') {
          end = escape(true);
          if (end === null || /^\\[pP]/.test(end)) return null;
        } else {
          end = String.fromCodePoint(pattern.codePointAt(pos));
          if (end === '[' || end === '-') return null;
          pos += end.length;
        }
        body += `-${end}`;
        count += 1;
        previousWasChar = false;
        continue;
      }
      if (char === '\\') {
        const escaped = escape(true);
        if (escaped === null) return null;
        body += escaped;
        previousWasChar = !/^\\[pP]/.test(escaped);
      } else {
        const full = String.fromCodePoint(pattern.codePointAt(pos));
        body += full;
        pos += full.length;
        previousWasChar = true;
      }
      count += 1;
    }
  };

  const quantifier = () => {
    const char = peek();
    if (char === '*' || char === '+' || char === '?') {
      pos += 1;
      return char;
    }
    if (char !== '{') return '';
    const match = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(pos));
    if (!match) return null;
    if (match[3] && Number(match[3]) < Number(match[1])) return null;
    pos += match[0].length;
    return match[0];
  };

  const branchList = (depth) => {
    let out = '';
    for (;;) {
      const char = peek();
      if (char === undefined) return depth === 0 ? out : null;
      if (char === ')') return depth > 0 ? out : null;
      if (char === '|') {
        out += '|';
        pos += 1;
        continue;
      }
      let atom;
      if (char === '(') {
        pos += 1;
        const inner = branchList(depth + 1);
        if (inner === null || peek() !== ')') return null;
        pos += 1;
        atom = `(?:${inner})`;
      } else if (char === '[') {
        atom = charClass();
      } else if (char === '\\') {
        atom = escape(false);
      } else if (char === '.') {
        pos += 1;
        atom = notIn('\\n\\r');
      } else if ('*+?{}]'.includes(char)) {
        return null;
      } else {
        // '^' and '$' act as anchors, as the JSONPath compliance suite expects.
        atom = String.fromCodePoint(pattern.codePointAt(pos));
        pos += atom.length;
      }
      if (atom === null) return null;
      const q = quantifier();
      if (q === null) return null;
      out += atom + q;
    }
  };

  const translated = branchList(0);
  return translated === null || pos !== pattern.length ? null : translated;
}

function compileRegex(pattern, anchored) {
  const key = `${anchored ? 'm' : 's'}:${pattern}`;
  if (!regexCache.has(key)) {
    const source = translateIRegexp(pattern);
    let regex = null;
    if (source !== null) {
      try {
        regex = new RegExp(anchored ? `^(?:${source})$` : source, 'u');
      } catch {
        regex = null;
      }
    }
    regexCache.set(key, regex);
  }
  return regexCache.get(key);
}

/* ─── Evaluation ─── */

function deepEqual(a, b) {
  if (isNumber(a) && isNumber(b)) return numberKey(a) === numberKey(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isObject(a) || isObject(b)) {
    if (!isObject(a) || !isObject(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => hasOwn(b, key) && deepEqual(a[key], b[key]));
  }
  return a === b;
}

function compareValues(op, a, b) {
  if (op === '!=') return !compareValues('==', a, b);
  if (op === '>') return compareValues('<', b, a);
  if (op === '<=') return compareValues('<', a, b) || compareValues('==', a, b);
  if (op === '>=') return compareValues('<', b, a) || compareValues('==', a, b);
  if (op === '==') return a === NOTHING || b === NOTHING ? a === b : deepEqual(a, b);
  // '<'
  if (isNumber(a) && isNumber(b)) return compareNumbers(a, b) < 0;
  if (typeof a === 'string' && typeof b === 'string') return compareCodePoints(a, b) < 0;
  return false;
}

/**
 * A value found in the document. Its path (the keys and indices from the root) is built only when
 * asked for, from the chain of parents: copying paths as the query walks down would cost time and
 * memory in proportion to the square of the depth.
 */
class PathNode {
  constructor(value, parent = null, key = undefined) {
    this.value = value;
    this.parent = parent;
    this.key = key;
    this.keys = null;
  }

  get path() {
    if (this.keys === null) {
      const keys = [];
      for (let node = this; node.parent !== null; node = node.parent) keys.push(node.key);
      this.keys = keys.reverse();
    }
    return this.keys;
  }
}

function children(node) {
  const { value } = node;
  if (Array.isArray(value)) return value.map((item, index) => new PathNode(item, node, index));
  if (isObject(value)) return Object.keys(value).map((key) => new PathNode(value[key], node, key));
  return [];
}

/** The node and all its descendants in document order (iterative, so depth cannot overflow the stack). */
function descendants(node) {
  const out = [];
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    out.push(current);
    const kids = children(current);
    for (let index = kids.length - 1; index >= 0; index -= 1) stack.push(kids[index]);
  }
  return out;
}

function sliceIndices(length, { start, end, step }) {
  const stride = step ?? 1;
  if (stride === 0) return [];
  const normalize = (index) => (index >= 0 ? index : length + index);
  const indices = [];
  if (stride > 0) {
    const lower = Math.min(Math.max(normalize(start ?? 0), 0), length);
    const upper = Math.min(Math.max(normalize(end ?? length), 0), length);
    for (let index = lower; index < upper; index += stride) indices.push(index);
  } else {
    const upper = Math.min(Math.max(normalize(start ?? length - 1), -1), length - 1);
    const lower = Math.min(Math.max(end === null || end === undefined ? -1 : normalize(end), -1), length - 1);
    for (let index = upper; lower < index; index += stride) indices.push(index);
  }
  return indices;
}

class Evaluator {
  constructor(root, conceal = null) {
    this.root = root;
    // (node) => what filters may read of the node's value, or CONCEALED; null reads values as they are.
    this.conceal = conceal;
  }

  /** A node's value as filters read it. */
  read(node) {
    if (this.conceal === null) return node.value;
    const value = this.conceal(node);
    return value === CONCEALED ? NOTHING : value;
  }

  run(query, current) {
    return this.runSegments(query.segments, [query.root === '$' ? new PathNode(this.root) : current]);
  }

  runSegments(segments, start) {
    let nodes = start;
    for (const segment of segments) {
      const next = [];
      for (const node of nodes) {
        const targets = segment.descendant ? descendants(node) : [node];
        for (const target of targets) {
          for (const selector of segment.selectors) this.select(target, selector, next);
        }
      }
      nodes = next;
    }
    return nodes;
  }

  select(node, selector, out) {
    const { value } = node;
    switch (selector.type) {
      case 'name':
        if (isObject(value) && hasOwn(value, selector.name)) out.push(new PathNode(value[selector.name], node, selector.name));
        break;
      case 'wildcard':
        // One push per child: spreading a large array into push() overflows the call stack.
        children(node).forEach((child) => out.push(child));
        break;
      case 'index':
        if (Array.isArray(value)) {
          const index = selector.index < 0 ? value.length + selector.index : selector.index;
          if (index >= 0 && index < value.length) out.push(new PathNode(value[index], node, index));
        }
        break;
      case 'slice':
        if (Array.isArray(value)) sliceIndices(value.length, selector).forEach((index) => out.push(new PathNode(value[index], node, index)));
        break;
      default:
        children(node).forEach((child) => {
          if (this.test(selector.expression, child)) out.push(child);
        });
    }
  }

  test(expression, current) {
    switch (expression.type) {
      case 'or':
        return expression.items.some((item) => this.test(item, current));
      case 'and':
        return expression.items.every((item) => this.test(item, current));
      case 'not':
        return !this.test(expression.expression, current);
      case 'compare':
        return compareValues(expression.op, this.valueOf(expression.left, current), this.valueOf(expression.right, current));
      default: {
        const { operand } = expression;
        if (operand.type === 'query') return this.run(operand, current).length > 0;
        // Only match() and search() can stand as a test; they return true or false.
        return this.call(operand, current);
      }
    }
  }

  valueOf(operand, current) {
    if (operand.type === 'literal') return operand.value;
    if (operand.type === 'query') {
      const nodes = this.run(operand, current);
      return nodes.length === 1 ? this.read(nodes[0]) : NOTHING;
    }
    return this.call(operand, current);
  }

  // RFC 9535's functions take nodes (count, value) or values (length, match, search), never logical arguments.
  argument(node, param, current) {
    return param === 'nodes' ? this.run(node, current) : this.valueOf(node, current);
  }

  call(fn, current) {
    const { params } = FUNCTIONS[fn.name];
    const args = fn.args.map((node, index) => this.argument(node, params[index], current));
    switch (fn.name) {
      case 'length': {
        const [value] = args;
        if (typeof value === 'string') return [...value].length;
        if (Array.isArray(value)) return value.length;
        if (isObject(value)) return Object.keys(value).length;
        return NOTHING;
      }
      case 'count':
        return args[0].length;
      case 'value':
        return args[0].length === 1 ? this.read(args[0][0]) : NOTHING;
      default: {
        const [text, pattern] = args;
        if (typeof text !== 'string' || typeof pattern !== 'string') return false;
        const regex = compileRegex(pattern, fn.name === 'match');
        return regex !== null && regex.test(text);
      }
    }
  }
}

function usesRoot(node) {
  if (node === null || typeof node !== 'object') return false;
  if (node.type === 'query' && node.root === '$') return true;
  return Object.values(node).some((child) => (Array.isArray(child) ? child.some(usesRoot) : usesRoot(child)));
}

/**
 * For JSON Lines, where `$` is the list of records: when a query picks records with one wildcard,
 * filter, non-negative index or forward slice (e.g. `$[*].user`, `$[?@.level == 'error']`),
 * returns `{ match(record, index, { conceal }), last }` to evaluate it one record at a time (`last`
 * is the final index that can match, if any). `conceal` works as in compileJsonPath, with the
 * record as the root. Returns null when the query needs all records at once.
 */
export function compileRecordQuery(expression) {
  const query = new Parser(expression).parseQueryRoot();
  const [first, ...rest] = query.segments;
  // A later segment that refers to $ (the list of all records) needs them all at once.
  if (!first || first.descendant || first.selectors.length !== 1 || rest.some(usesRoot)) return null;
  const [selector] = first.selectors;
  let selects;
  let last = Infinity;
  if (selector.type === 'wildcard') {
    selects = () => true;
  } else if (selector.type === 'index' && selector.index >= 0) {
    selects = (index) => index === selector.index;
    last = selector.index;
  } else if (selector.type === 'slice' && (selector.start ?? 0) >= 0 && (selector.end ?? 0) >= 0 && (selector.step ?? 1) > 0) {
    const start = selector.start ?? 0;
    const step = selector.step ?? 1;
    const end = selector.end ?? Infinity;
    selects = (index) => index >= start && index < end && (index - start) % step === 0;
    last = end - 1;
  } else if (selector.type === 'filter' && !usesRoot(selector.expression)) {
    selects = null;
  } else {
    return null;
  }
  const evaluator = new Evaluator(undefined);
  const records = new PathNode(undefined);
  return {
    last,
    match(record, index, { conceal } = {}) {
      const node = new PathNode(record, records, index);
      // Within a record, paths start after its index ($[index] comes first).
      evaluator.conceal = conceal ? (found) => conceal(record, found.path.slice(1), found.value) : null;
      const selected = selects ? selects(index) : evaluator.test(selector.expression, node);
      return selected ? evaluator.runSegments(rest, [node]) : [];
    },
  };
}

/* ─── JSON Pointer (RFC 6901) ─── */

/** The reference tokens of a pointer: "" (the whole document) or "/…" (compilePath checks). */
function parsePointer(pointer) {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((token) => {
      if (/~(?![01])/.test(token)) throw new JsonPathError(`Invalid JSON Pointer: bad escape in "${token}" (use ~0 for ~ and ~1 for /)`);
      return token.replace(/~1/g, '/').replace(/~0/g, '~');
    });
}

function resolvePointer(root, tokens) {
  let node = new PathNode(root);
  for (const token of tokens) {
    const { value } = node;
    if (Array.isArray(value)) {
      if (!/^(0|[1-9]\d*)$/.test(token) || Number(token) >= value.length) return [];
      node = new PathNode(value[Number(token)], node, Number(token));
    } else if (isObject(value) && hasOwn(value, token)) {
      node = new PathNode(value[token], node, token);
    } else {
      return [];
    }
  }
  return [node];
}

/* ─── Public API ─── */

/**
 * Compiles a JSONPath query exactly as RFC 9535 defines it. Throws JsonPathError with a position.
 * `evaluate(root, { conceal })`: with `conceal(root, path, value)`, filters read each value as
 * conceal returns it (CONCEALED for one they must not read), so that a filter such as
 * [?@ == 'guess'] cannot probe a value the output masks. Only what filters read changes: names,
 * indices, slices, wildcards and existence tests ([?@.apiKey]) reach the same nodes.
 */
export function compileJsonPath(expression) {
  const query = new Parser(expression).parseQueryRoot();
  const singular = query.segments.every((segment) => !segment.descendant && segment.selectors.length === 1 && ['name', 'index'].includes(segment.selectors[0].type));
  return {
    kind: 'jsonpath',
    singular,
    evaluate: (root, { conceal } = {}) => new Evaluator(root, conceal ? (node) => conceal(root, node.path, node.value) : null).run(query),
  };
}

/** Compiles a JSONPath query, or a JSON Pointer (RFC 6901) when the path is empty or starts with "/". */
export function compilePath(expression) {
  if (expression === '' || expression.startsWith('/')) {
    const tokens = parsePointer(expression);
    return { kind: 'pointer', singular: true, evaluate: (root) => resolvePointer(root, tokens) };
  }
  return compileJsonPath(expression);
}


function escapeNormalized(name) {
  let out = '';
  for (const char of name) {
    const code = char.codePointAt(0);
    if (char === "'") out += "\\'";
    else if (char === '\\') out += '\\\\';
    else if (char === '\b') out += '\\b';
    else if (char === '\f') out += '\\f';
    else if (char === '\n') out += '\\n';
    else if (char === '\r') out += '\\r';
    else if (char === '\t') out += '\\t';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += char;
  }
  return out;
}

/** The RFC 9535 normalized path of a node, e.g. `$['store']['book'][0]`. */
export function normalizedPath(path) {
  return `$${path.map((segment) => (typeof segment === 'number' ? `[${segment}]` : `['${escapeNormalized(segment)}']`)).join('')}`;
}
