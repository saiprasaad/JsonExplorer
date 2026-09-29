import {
  createScanner,
  getLocation,
  parse as parseWithErrors,
  parseTree,
  printParseErrorCode,
  SyntaxKind,
  visit,
} from 'jsonc-parser';

const STRICT_OPTIONS = { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false };

/* ─── Exact numbers ─── */

/**
 * A JSON number whose literal a JavaScript number cannot reproduce: an integer beyond ±2^53, more
 * digits than a double holds, or a different spelling (1.50, 1e5, -0). Exact parses (see
 * parseJson's `exact` option) keep these, so exports and comparisons can use the literal as written.
 */
export class RawNumber {
  constructor(source) {
    this.source = source;
  }

  toString() {
    return this.source;
  }

  valueOf() {
    return Number(this.source);
  }

  toJSON() {
    return Number(this.source);
  }
}

const NUMBER_LITERAL = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** Sign, significant digits and exponent of a number literal, with zeros normalized away. */
function decimalParts(text) {
  const match = NUMBER_LITERAL.exec(text);
  if (!match) return null;
  const [, sign, integer, fraction = '', exponent = '0'] = match;
  const digits = (integer + fraction).replace(/^0+/, '');
  if (!digits) return { sign: '', digits: '0', exponent: 0, zero: true };
  let end = digits.length;
  while (digits.charCodeAt(end - 1) === 48) end -= 1; // Trailing zeros (a loop: /0+$/ backtracks on long runs).
  const significant = digits.slice(0, end);
  return { sign, digits: significant, exponent: Number(exponent) - fraction.length + (digits.length - significant.length), zero: false };
}

/**
 * A key for a JSON number's exact decimal value: equal for equal numbers however they are written
 * (1.5, 1.50 and 15e-1 match), different where doubles would round two values together.
 */
export function numberKey(value) {
  const text = value instanceof RawNumber ? value.source : String(value);
  const parts = decimalParts(text);
  if (!parts) return text;
  return parts.zero ? '0' : `${parts.sign}${parts.digits}e${parts.exponent}`;
}

/** Orders two numbers (or RawNumbers) by exact value: negative, zero or positive. */
export function compareNumbers(a, b) {
  const x = numberKey(a);
  const y = numberKey(b);
  if (x === y) return 0;
  const parse = (key) => {
    if (key === '0') return { sign: 0, digits: '', exponent: 0 };
    const [, sign, digits, exponent] = /^(-?)(\d+)e(-?\d+)$/.exec(key);
    return { sign: sign ? -1 : 1, digits, exponent: Number(exponent) };
  };
  const p = parse(x);
  const q = parse(y);
  if (p.sign !== q.sign) return p.sign < q.sign ? -1 : 1;
  // Same sign: compare magnitudes by the position of the leading digit, then digit by digit.
  let order = p.digits.length + p.exponent - (q.digits.length + q.exponent);
  if (order === 0) {
    const width = Math.max(p.digits.length, q.digits.length);
    const left = p.digits.padEnd(width, '0');
    const right = q.digits.padEnd(width, '0');
    order = left < right ? -1 : 1;
  }
  return p.sign * Math.sign(order);
}

export function isNumber(value) {
  return typeof value === 'number' || value instanceof RawNumber;
}

/** Whether a number (or RawNumber) has no fractional part, as JSON Schema's "integer" means it. */
export function isIntegerNumber(value) {
  if (typeof value === 'number') return Number.isInteger(value);
  if (!(value instanceof RawNumber)) return false;
  const parts = decimalParts(value.source);
  return Boolean(parts) && (parts.zero || parts.exponent >= 0);
}

/** The value of a number or RawNumber as a double (approximate for RawNumbers beyond double precision). */
export function toNumber(value) {
  return value instanceof RawNumber ? Number(value.source) : value;
}

/* ─── Value helpers ─── */

export function getValueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof RawNumber) return 'number';
  return typeof value;
}

export function isContainer(value) {
  return value !== null && typeof value === 'object' && !(value instanceof RawNumber);
}

export function countEntries(value) {
  if (Array.isArray(value)) return value.length;
  if (isContainer(value)) return Object.keys(value).length;
  return 0;
}

export function getValueAtPath(root, path) {
  let current = root;
  for (const segment of path) {
    if (!isContainer(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

/** Short, single-line preview of a value, e.g. `"text"`, `42`, `{3 keys}`, `[5 items]`. */
export function previewValue(value, maxLength = 80) {
  if (Array.isArray(value)) return `[${pluralize(value.length, 'item')}]`;
  if (isContainer(value)) return `{${pluralize(Object.keys(value).length, 'key')}}`;
  const text = typeof value === 'string' ? JSON.stringify(value) : String(value);
  return truncate(text, maxLength);
}

export function pluralize(count, noun) {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}

const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;

/** `text.slice(0, end)`, moved back one unit if it would split a surrogate pair (e.g. an emoji). */
export function sliceText(text, end) {
  if (end > 0 && end < text.length && isHighSurrogate(text.charCodeAt(end - 1)) && isLowSurrogate(text.charCodeAt(end))) {
    return text.slice(0, end - 1);
  }
  return text.slice(0, end);
}

export function truncate(text, maxLength) {
  return text.length > maxLength ? `${sliceText(text, Math.max(0, maxLength - 1))}…` : text;
}

/* ─── Parsing ─── */

const BOM = 0xfeff;

// Where JSON.parse exposes each literal's source text (`context.source`), numbers a double cannot
// reproduce are kept exactly, as RawNumbers. Elsewhere (Node.js before 21, older browsers) a
// slower parse from jsonc-parser's scanner does the same. Exports and comparisons use this; views
// mark such numbers with ≈.
const SOURCE_TEXT_ACCESS = (() => {
  try {
    let supported = false;
    JSON.parse('1', (key, value, context) => {
      supported = typeof context?.source === 'string';
      return value;
    });
    return supported;
  } catch {
    return false;
  }
})();

// A number literal a double may not reproduce exactly: 16+ digits, an exponent, a trailing
// fractional zero or a negative zero. (Matches inside strings are harmless false positives.)
const INEXACT_LITERAL = /\d(?:\.?\d){15}|\d[eE]|\.\d*0(?!\d)|-0(?![\d.eE])/;

/** Whether the text may hold a number literal that plain JSON.parse and JSON.stringify would change. */
export function mayContainInexactNumbers(text) {
  return INEXACT_LITERAL.test(text);
}

function exactReviver(key, value, context) {
  if (typeof value === 'number' && context && context.source !== String(value)) return new RawNumber(context.source);
  return value;
}

/**
 * An exact parse without JSON.parse source text access: the value built from jsonc-parser's
 * visitor, with RawNumbers for literals a double cannot reproduce. Only for valid JSON text.
 */
function parseExactByVisitor(text) {
  const containers = [];
  let root;
  let key;
  const attach = (value) => {
    const parent = containers[containers.length - 1];
    if (parent === undefined) root = value;
    else if (Array.isArray(parent)) parent.push(value);
    // A data property, as JSON.parse makes it, even for "__proto__".
    else Object.defineProperty(parent, key, { value, writable: true, enumerable: true, configurable: true });
  };
  const open = (container) => {
    attach(container);
    containers.push(container);
  };
  const close = () => containers.pop();
  visit(
    text,
    {
      onObjectBegin: () => open({}),
      onObjectProperty: (name) => {
        key = name;
      },
      onObjectEnd: close,
      onArrayBegin: () => open([]),
      onArrayEnd: close,
      onLiteralValue: (value, offset, length) => {
        const literal = typeof value === 'number' ? text.substr(offset, length) : null;
        attach(literal !== null && literal !== String(value) ? new RawNumber(literal) : value);
      },
    },
    STRICT_OPTIONS
  );
  return root;
}

/**
 * Parses JSON text into `{ ok: true, value }`, or `{ ok: false, empty, error }` where
 * `error` carries a friendly message plus the 1-based line/column of the problem.
 * With `exact`, numbers a double cannot reproduce exactly are returned as RawNumbers (where supported).
 */
export function parseJson(text, { exact = false } = {}) {
  const source = text ?? '';
  const hasBom = source.charCodeAt(0) === BOM;
  const body = hasBom ? source.slice(1) : source;

  if (!body.trim()) {
    return { ok: false, empty: true, error: null };
  }

  try {
    if (!exact || !INEXACT_LITERAL.test(body)) return { ok: true, value: JSON.parse(body) };
    if (SOURCE_TEXT_ACCESS) return { ok: true, value: JSON.parse(body, exactReviver) };
    const value = JSON.parse(body);
    try {
      return { ok: true, value: parseExactByVisitor(body) };
    } catch {
      // Nested too deeply for the scanner's recursion: the numbers stay as doubles, and callers say so.
      return { ok: true, value, rounded: true };
    }
  } catch (nativeError) {
    const error = describeJsonError(body, nativeError);
    if (hasBom) {
      error.offset += 1;
      Object.assign(error, offsetToLineColumn(source, error.offset));
    }
    return { ok: false, empty: false, error };
  }
}

let stringifyCalls = 0;

/** JSON.stringify that writes RawNumbers (from exact parses) exactly as they were written. */
export function stringifyJson(value, indent) {
  const raw = typeof JSON.rawJSON === 'function';
  const literals = [];
  // Without JSON.rawJSON, each RawNumber is written as a unique placeholder string, then replaced.
  stringifyCalls += 1;
  const placeholder = raw ? '' : `\u0000raw-${stringifyCalls}-${Math.random().toString(36).slice(2)}-`;
  const text = JSON.stringify(
    value,
    function replace(key, item) {
      // `this[key]` is the value before toJSON, which turns a RawNumber into a plain (rounded) number.
      const original = this[key];
      if (!(original instanceof RawNumber)) return item;
      if (raw) return JSON.rawJSON(original.source);
      literals.push(original.source);
      return `${placeholder}${literals.length - 1}`;
    },
    indent
  );
  if (literals.length === 0) return text;
  const quoted = JSON.stringify(placeholder).slice(0, -1);
  return text.replace(new RegExp(`${quoted.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}(\\d+)"`, 'g'), (match, index) => literals[Number(index)]);
}

export function isValidJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

const PYTHON_LITERALS = new Map([
  ['None', 'null'],
  ['True', 'true'],
  ['False', 'false'],
]);

const ERROR_MESSAGES = {
  InvalidNumberFormat: 'Invalid number',
  PropertyNameExpected: 'Expected a property name in double quotes',
  ValueExpected: 'Expected a value',
  ColonExpected: "Expected ':' after the property name",
  CommaExpected: "Expected ',' between items",
  CloseBraceExpected: "Expected '}' to close the object",
  CloseBracketExpected: "Expected ']' to close the array",
  EndOfFileExpected: 'Unexpected content after the end of the JSON value',
  InvalidCommentToken: 'Comments are not allowed in JSON',
  UnexpectedEndOfComment: 'Unterminated comment — the closing */ is missing',
  UnexpectedEndOfString: 'Unterminated string',
  UnexpectedEndOfNumber: 'Incomplete number',
  InvalidUnicode: 'Invalid unicode escape sequence',
  InvalidEscapeCharacter: 'Invalid escape sequence in string',
  InvalidCharacter: 'Control characters (tabs, line breaks) must be escaped inside strings',
};

function previousSignificantIndex(text, offset) {
  let index = offset - 1;
  while (index >= 0 && /\s/.test(text[index])) index -= 1;
  return index;
}

function explainParseError(text, error, nextError) {
  const code = printParseErrorCode(error.error);
  const token = text.substr(error.offset, error.length);
  const at = (message, offset = error.offset) => ({ message, offset });

  switch (code) {
    case 'InvalidSymbol': {
      if (token.startsWith("'")) return at('Strings and property names must use double quotes');
      if (PYTHON_LITERALS.has(token)) return at(`'${token}' is not valid JSON — use ${PYTHON_LITERALS.get(token)}`);
      if (token === 'undefined') return at("'undefined' is not valid JSON — use null");
      if (/^[+-]?(NaN|Infinity)$/.test(token)) return at(`'${token}' is not a valid JSON number`);
      // The scanner reads a sign that is not followed by a digit as a token of its own.
      const signed = token === '-' || token === '+' ? /^(NaN|Infinity)\b/.exec(text.slice(error.offset + 1)) : null;
      if (signed) return at(`'${token}${signed[1]}' is not a valid JSON number`);
      if (/^\+[\d.]/.test(token)) return at("Numbers cannot start with '+'");
      if (
        /^[A-Za-z_$]/.test(token) &&
        nextError &&
        printParseErrorCode(nextError.error) === 'PropertyNameExpected'
      ) {
        return at('Property names must be wrapped in double quotes');
      }
      // Quote the character only when it is punctuation: unquoted text may be data (a password).
      if (token.length === 1 && !/[\p{L}\p{N}]/u.test(token) && token.charCodeAt(0) >= 0x20) return at(`Unexpected character '${token}'`);
      return at(/^[\p{L}\p{N}_$]/u.test(token) ? 'Unexpected text — strings must be in double quotes' : 'Unexpected characters');
    }
    case 'PropertyNameExpected':
    case 'ValueExpected': {
      const char = text[error.offset];
      const previousIndex = previousSignificantIndex(text, error.offset);
      if ((char === '}' || char === ']') && text[previousIndex] === ',') {
        return at(`Trailing comma before '${char}' is not allowed`, previousIndex);
      }
      if (error.offset >= text.length) return at('Unexpected end of input — the JSON is incomplete');
      return at(ERROR_MESSAGES[code]);
    }
    case 'CommaExpected': {
      if (/\d/.test(text[error.offset]) && text[error.offset - 1] === '0') {
        return at('Numbers cannot have leading zeros', error.offset - 1);
      }
      return at(ERROR_MESSAGES[code]);
    }
    case 'CloseBraceExpected':
    case 'CloseBracketExpected':
      return at(
        error.offset >= text.length
          ? `Unexpected end of input — ${ERROR_MESSAGES[code].charAt(0).toLowerCase()}${ERROR_MESSAGES[code].slice(1)}`
          : ERROR_MESSAGES[code]
      );
    case 'UnexpectedEndOfString': {
      // The scanner stops a string at a raw line break; point at the break rather than the opening quote.
      const end = error.offset + error.length;
      if (text[end] === '\n' || text[end] === '\r') return at('Line breaks inside strings must be escaped as \\n', end);
      return at('Unterminated string — the closing quote is missing');
    }
    case 'InvalidCharacter': {
      const end = error.offset + error.length;
      for (let index = error.offset + 1; index < end; index += 1) {
        if (text.charCodeAt(index) < 0x20) return at(ERROR_MESSAGES[code], index);
      }
      return at(ERROR_MESSAGES[code]);
    }
    case 'InvalidEscapeCharacter': {
      const end = error.offset + error.length;
      for (let index = error.offset + 1; index < end - 1; index += 1) {
        if (text[index] === '\\') {
          if (!/["\\/bfnrtu]/.test(text[index + 1])) {
            return at(`Invalid escape sequence '\\${text[index + 1]}' in string`, index);
          }
          index += 1;
        }
      }
      return at(ERROR_MESSAGES[code]);
    }
    default:
      return at(ERROR_MESSAGES[code] || 'Invalid JSON');
  }
}

function extractNativeOffset(text, message = '') {
  const lineColumn = /line (\d+) column (\d+)/.exec(message);
  if (lineColumn) {
    return lineColumnToOffset(text, Number(lineColumn[1]), Number(lineColumn[2]));
  }
  const position = /position (\d+)/.exec(message);
  return position ? Math.min(Number(position[1]), text.length) : 0;
}

export const JSONC_OPTIONS = { disallowComments: false, allowTrailingComma: true, allowEmptyContent: false };

/** A friendly error for invalid text. `options` are jsonc-parser's (JSONC_OPTIONS for JSON with comments). */
export function describeJsonError(text, nativeError, options = STRICT_OPTIONS) {
  const errors = [];
  try {
    parseWithErrors(text, errors, options);
  } catch {
    // jsonc-parser recurses per nesting level; extremely deep input falls back to the native message.
    errors.length = 0;
  }

  let offset;
  let message;
  if (errors.length > 0) {
    ({ offset, message } = explainParseError(text, errors[0], errors[1]));
  } else {
    // The engine's own message quotes the text around the error, which may be data: keep only where it is.
    offset = extractNativeOffset(text, nativeError?.message);
    message = 'Invalid JSON';
  }

  return { message, offset, ...offsetToLineColumn(text, offset) };
}

export function offsetToLineColumn(text, offset) {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(offset, text.length);
  for (let index = 0; index < end; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

export function lineColumnToOffset(text, line, column) {
  let currentLine = 1;
  let index = 0;
  while (currentLine < line && index < text.length) {
    if (text.charCodeAt(index) === 10) currentLine += 1;
    index += 1;
  }
  return Math.min(index + column - 1, text.length);
}

/* ─── Lossless transforms ─── */
// These operate on the source text rather than on parsed JS values, so number literals
// (e.g. 12345678901234567890 or 1.50), string escapes and key order survive untouched.

function indentUnit(indent) {
  if (indent === '\t') return '\t';
  return ' '.repeat(Math.max(0, Number(indent) || 0));
}

function assertValidJson(text) {
  const result = parseJson(text);
  if (!result.ok) {
    const reason = result.empty ? 'the document is empty' : `${result.error.message} (line ${result.error.line}, column ${result.error.column})`;
    throw new Error(`Cannot transform invalid JSON: ${reason}`);
  }
  return result.value;
}

/** Pretty-prints JSON text. `indent` is a number of spaces, `'\t'`, or 0 to minify. */
export function formatJson(text, indent = 2) {
  assertValidJson(text);
  const unit = indentUnit(indent);
  const source = text.charCodeAt(0) === BOM ? text.slice(1) : text;
  const scanner = createScanner(source, true);
  const out = [];
  let level = 0;
  let justOpened = false;
  const newline = () => {
    if (unit) out.push('\n', unit.repeat(level));
  };

  for (let kind = scanner.scan(); kind !== SyntaxKind.EOF; kind = scanner.scan()) {
    const closes = kind === SyntaxKind.CloseBraceToken || kind === SyntaxKind.CloseBracketToken;
    if (closes) {
      level -= 1;
      if (!justOpened) newline();
    } else if (justOpened) {
      newline();
    }
    justOpened = false;

    switch (kind) {
      case SyntaxKind.OpenBraceToken:
        out.push('{');
        level += 1;
        justOpened = true;
        break;
      case SyntaxKind.OpenBracketToken:
        out.push('[');
        level += 1;
        justOpened = true;
        break;
      case SyntaxKind.CloseBraceToken:
        out.push('}');
        break;
      case SyntaxKind.CloseBracketToken:
        out.push(']');
        break;
      case SyntaxKind.CommaToken:
        out.push(',');
        newline();
        break;
      case SyntaxKind.ColonToken:
        out.push(unit ? ': ' : ':');
        break;
      default:
        out.push(source.substr(scanner.getTokenOffset(), scanner.getTokenLength()));
    }
  }
  return out.join('');
}

export function minifyJson(text) {
  return formatJson(text, 0);
}

// UTF-16 code units sort surrogate pairs (U+10000 and up) before U+E000–U+FFFF; shift them so
// the comparison follows code points, as UTF-8 byte order (and jq) does.
const codePointOrder = (unit) => (unit >= 0xe000 ? unit - 0x800 : unit >= 0xd800 ? unit + 0x2000 : unit);

/** Compares strings by Unicode code point (negative, zero or positive, like a sort comparator). */
export function compareCodePoints(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.charCodeAt(index);
    const b = right.charCodeAt(index);
    if (a !== b) return codePointOrder(a) - codePointOrder(b);
  }
  return left.length - right.length;
}

/** Recursively sorts object keys (by code point, like `jq -S`) and pretty-prints. */
export function sortJsonKeys(text, indent = 2) {
  assertValidJson(text);
  const source = text.charCodeAt(0) === BOM ? text.slice(1) : text;
  const root = parseTree(source, [], STRICT_OPTIONS);
  const unit = indentUnit(indent);
  const out = [];
  const raw = (node) => source.substr(node.offset, node.length);
  const newline = (level) => {
    if (unit) out.push('\n', unit.repeat(level));
  };

  const emit = (node, level) => {
    if (node.type === 'object' || node.type === 'array') {
      const isObject = node.type === 'object';
      let children = node.children || [];
      if (children.length === 0) {
        out.push(isObject ? '{}' : '[]');
        return;
      }
      if (isObject) {
        children = [...children].sort((left, right) => compareCodePoints(left.children[0].value, right.children[0].value));
      }
      out.push(isObject ? '{' : '[');
      children.forEach((child, index) => {
        newline(level + 1);
        if (isObject) {
          out.push(raw(child.children[0]), unit ? ': ' : ':');
          emit(child.children[1], level + 1);
        } else {
          emit(child, level + 1);
        }
        if (index < children.length - 1) out.push(',');
      });
      newline(level);
      out.push(isObject ? '}' : ']');
      return;
    }
    out.push(raw(node));
  };

  emit(root, 0);
  return out.join('');
}

/* ─── Paths ─── */

export const PATH_FORMATS = [
  { id: 'jsonpath', label: 'JSONPath' },
  { id: 'js', label: 'JavaScript' },
  { id: 'jq', label: 'jq' },
  { id: 'pointer', label: 'JSON Pointer' },
];

const JS_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const PLAIN_IDENTIFIER = /^[A-Za-z_]\w*$/;

export function formatPath(path, format = 'jsonpath') {
  if (format === 'pointer') {
    return path.map((segment) => `/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
  }

  if (format === 'jq') {
    if (path.length === 0) return '.';
    return path
      .map((segment, index) => {
        if (typeof segment === 'number') return index === 0 ? `.[${segment}]` : `[${segment}]`;
        return PLAIN_IDENTIFIER.test(segment) ? `.${segment}` : `.${JSON.stringify(segment)}`;
      })
      .join('');
  }

  const identifier = format === 'js' ? JS_IDENTIFIER : PLAIN_IDENTIFIER;
  let result = format === 'js' ? 'data' : '$';
  for (const segment of path) {
    if (typeof segment === 'number') result += `[${segment}]`;
    else if (identifier.test(segment)) result += `.${segment}`;
    else result += `[${JSON.stringify(segment)}]`;
  }
  return result;
}

/* ─── Text ↔ path mapping (for editor sync) ─── */

let treeCache = { text: null, root: null };

function getSyntaxTree(text) {
  if (treeCache.text !== text) {
    let root = null;
    try {
      root = parseTree(text, [], { allowTrailingComma: true }) ?? null;
    } catch {
      // Nesting deep enough to overflow the (recursive) parser: no source mapping for this text.
    }
    treeCache = { text, root };
  }
  return treeCache.root;
}

/** Like jsonc-parser's findNodeAtLocation, but a duplicated key resolves to its last occurrence, as in JSON.parse. */
function findNodeAtPath(root, path) {
  let node = root;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (node.type !== 'array' || !node.children || segment < 0 || segment >= node.children.length) return null;
      node = node.children[segment];
    } else {
      if (node.type !== 'object' || !node.children) return null;
      let match = null;
      for (const property of node.children) {
        if (property.children?.length === 2 && property.children[0].value === segment) match = property.children[1];
      }
      if (!match) return null;
      node = match;
    }
  }
  return node;
}

/** Finds where the value at `path` lives in the source text. */
export function findPathRange(text, path) {
  const root = getSyntaxTree(text);
  if (!root) return null;
  const node = findNodeAtPath(root, path);
  if (!node) return null;
  const keyNode = node.parent && node.parent.type === 'property' ? node.parent.children[0] : null;
  return {
    offset: node.offset,
    length: node.length,
    keyOffset: keyNode ? keyNode.offset : null,
    keyLength: keyNode ? keyNode.length : null,
  };
}

/**
 * Pretty-printed JSON for the value at `path`, taken from the source text when possible so every
 * literal (large integers, 1.50, escapes) appears exactly as written; `exact` says whether it was.
 */
export function valueJsonText(sourceText, path, value, maxSlice = 200_000) {
  if (sourceText) {
    const range = findPathRange(sourceText, path);
    if (range && range.length <= maxSlice) {
      try {
        return { text: formatJson(sourceText.substr(range.offset, range.length)), exact: true };
      } catch {
        // Fall back to serializing the parsed value.
      }
    }
  }
  let text;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    // Nested too deeply to serialize.
  }
  return { text: text ?? String(value), exact: false };
}

/** Returns the JSON path of the value at a text offset (e.g. the editor cursor), or null if unknown. */
export function getPathAtOffset(text, offset) {
  let location;
  try {
    location = getLocation(text, offset);
  } catch {
    return null;
  }
  const { path } = location;
  // Between properties, jsonc-parser ends the path with a '' placeholder; a real "" key has a previous node.
  if (path[path.length - 1] === '' && location.isAtPropertyKey && !location.previousNode) path.pop();
  return path;
}

/* ─── Statistics & sizes ─── */

export function computeStats(root) {
  const stats = { objects: 0, arrays: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, keys: 0, maxDepth: 0 };
  const values = [root];
  const depths = [0];

  while (values.length > 0) {
    const value = values.pop();
    const depth = depths.pop();
    if (depth > stats.maxDepth) stats.maxDepth = depth;

    if (Array.isArray(value)) {
      stats.arrays += 1;
      for (let index = 0; index < value.length; index += 1) {
        values.push(value[index]);
        depths.push(depth + 1);
      }
    } else if (value === null) {
      stats.nulls += 1;
    } else if (typeof value === 'object') {
      stats.objects += 1;
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          stats.keys += 1;
          values.push(value[key]);
          depths.push(depth + 1);
        }
      }
    } else if (typeof value === 'string') {
      stats.strings += 1;
    } else if (typeof value === 'number') {
      stats.numbers += 1;
    } else if (typeof value === 'boolean') {
      stats.booleans += 1;
    }
  }

  stats.values = stats.objects + stats.arrays + stats.strings + stats.numbers + stats.booleans + stats.nulls;
  return stats;
}

export function utf8ByteLength(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
