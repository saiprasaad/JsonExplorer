import { isContainer } from '../utils/json';

/**
 * Secret-aware output: values under keys that name credentials (password, apiKey, access_token,
 * Authorization, …), anywhere below such a key, and strings that look like well-known secret
 * formats are masked, so they do not end up in a chat transcript or a terminal log. Only output
 * is masked; files are untouched. Every pattern here runs in linear time, whatever the input.
 */
export const REDACTED = '[REDACTED]';

const SECRET_WORDS = new Set(['password', 'passwd', 'pwd', 'pass', 'passphrase', 'secret', 'credential', 'cookie', 'authorization', 'dsn', 'ssn', 'cvv', 'cvc', 'pin', 'otp', 'iban']);
// Words that make a name sensitive when they end it: session, userSession or sid, but not
// session_count, sessionDuration or sidebar.
const SECRET_LAST_WORDS = new Set(['session', 'sid', 'sids']);
const SECRET_SUFFIXES = [
  'creditcard',
  'debitcard',
  'cardnumber',
  'cardnum',
  'cardno',
  'ccnumber',
  'ccnum',
  'token',
  'apikey',
  'accesskey',
  'privatekey',
  'secretkey',
  'sessionid',
  'sessionkey',
  'bearer',
  'signingkey',
  'encryptionkey',
  'masterkey',
  'authkey',
  'webhookurl',
  'connectionstring',
];

// Fields that hold the name of a setting and fields that hold its value, as in Kubernetes env
// lists, HTTP headers in HAR files or CloudFormation parameters: {"name": "DB_PASSWORD", "value": "…"}.
const NAME_FIELDS = new Set(['name', 'key', 'parameterkey', 'optionname', 'header', 'headername', 'field', 'fieldname', 'variable', 'varname']);
const VALUE_FIELDS = new Set(['value', 'values', 'val', 'parametervalue', 'optionvalue', 'secretvalue', 'data', 'content']);

const SECRET_VALUE_PATTERNS = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{36,}/, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{22,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/, // GitLab
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/, // Slack
  /\bhttps:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/_-]{10,}/, // Slack webhooks
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/, // Stripe
  /\bAIza[0-9A-Za-z_-]{35}/, // Google API key
  /\bGOCSPX-[A-Za-z0-9_-]{20,}/, // Google OAuth client secret
  /\bsk-[A-Za-z0-9_-]{20,}/, // OpenAI / Anthropic style keys
  /\bnpm_[A-Za-z0-9]{36}/, // npm
  /\bhf_[A-Za-z0-9]{30,}/, // Hugging Face
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/, // SendGrid
  /\bdo[por]_v1_[a-f0-9]{64}/, // DigitalOcean
  // A JWT, starting where a run of token characters starts (so a long run is scanned once).
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----/,
  /\b(?:Bearer|Basic)\s{1,10}[A-Za-z0-9._~+/-]{16,}/, // Authorization header values
  /\b[a-z][a-z0-9+.-]{0,30}:\/\/[^\s:/@]{1,256}:[^\s@/]{1,256}@/i, // credentials inside a URL
  /\b(?:password|pwd|accountkey|sharedaccesskey|sharedaccesssignature|clientsecret)\s{0,5}=\s{0,5}[^;"'\s]{3,}/i, // connection strings
  /[?&](?:access_token|refresh_token|id_token|token|api_key|apikey|key|secret|password|sig|signature|client_secret)=[^&#\s"']{8,}/i, // URL parameters
];

const fieldName = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Whether a member name suggests its value is a credential (plurals too: tokens, apiKeys). */
export function isSensitiveKey(key) {
  if (typeof key !== 'string') return false;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.some((word) => SECRET_WORDS.has(word) || (word.endsWith('s') && SECRET_WORDS.has(word.slice(0, -1))))) return true;
  if (SECRET_LAST_WORDS.has(words[words.length - 1])) return true;
  const joined = words.join('');
  return joined === 'auth' || SECRET_SUFFIXES.some((suffix) => joined.endsWith(suffix) || joined.endsWith(`${suffix}s`));
}

// The length of the shortest string any pattern above matches: a connection string's pwd setting
// with a three-character value. Card numbers are longer.
const MIN_SECRET_LENGTH = 7;
// 13 to 19 digits, which may be grouped with single spaces or dashes: 4111 1111 1111 1111.
const CARD_DIGITS = /^\d(?:[ -]?\d){12,18}$/;
// The first digits of the major card networks (Visa, Mastercard, Amex, Discover, JCB, Diners, UnionPay, Maestro).
const CARD_PREFIX = /^(?:4|5|6|2[2-7]|3[04-9])/;

/** Whether the digits pass the Luhn check that every payment card number carries. */
function luhn(digits) {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = digits.charCodeAt(digits.length - 1 - index) - 48;
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Whether a whole string is a payment card number: a card network's prefix and a valid check digit. */
function looksLikeCardNumber(text) {
  const trimmed = text.trim();
  if (!CARD_DIGITS.test(trimmed)) return false;
  const digits = trimmed.replace(/[ -]/g, '');
  return CARD_PREFIX.test(digits) && luhn(digits);
}

/** Whether a string looks like a well-known secret (API keys, tokens, private keys, credentials in URLs, card numbers). */
export function looksLikeSecret(value) {
  if (typeof value !== 'string' || value.length < MIN_SECRET_LENGTH) return false;
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value)) || looksLikeCardNumber(value);
}

/** Whether an object names a credential in a name-like field ({"name": "API_TOKEN", "value": …}). */
function namesSecret(object) {
  return Object.keys(object).some((name) => NAME_FIELDS.has(fieldName(name)) && typeof object[name] === 'string' && isSensitiveKey(object[name]));
}

/** Whether the member `key` of `object` holds a secret: a sensitive name, or the value of a setting whose name is sensitive. */
export function isSensitiveMember(object, key) {
  return isSensitiveKey(key) || (VALUE_FIELDS.has(fieldName(key)) && namesSecret(object));
}

/**
 * A copy of `value` with secret-looking values replaced by "[REDACTED]" (or `replacement`).
 * Everything under a sensitive key is masked, and so is the value of a setting whose name is
 * sensitive. `key` is the member name the value sits under, if any; `inherited` is true when an
 * ancestor is sensitive (see isSensitivePath). `counter.count` is incremented for each masked value.
 */
export function redactValue(value, key, counter, inherited = false, replacement = REDACTED) {
  const sensitive = inherited || isSensitiveKey(key);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, undefined, counter, sensitive, replacement));
  if (isContainer(value)) {
    const settings = namesSecret(value);
    const copy = {};
    for (const name of Object.keys(value)) {
      const hidden = sensitive || (settings && VALUE_FIELDS.has(fieldName(name)));
      Object.defineProperty(copy, name, { value: redactValue(value[name], name, counter, hidden, replacement), enumerable: true, writable: true, configurable: true });
    }
    return copy;
  }
  // true/false/null say nothing secret; strings and numbers (a PIN) may.
  if (value !== null && typeof value !== 'boolean' && (sensitive || looksLikeSecret(value))) {
    counter.count += 1;
    return replacement;
  }
  return value;
}

/**
 * Whether the value at `pathArray` (keys and indices from `root`) sits under a sensitive key, or
 * is the value of a setting whose name is sensitive.
 */
export function isSensitivePath(root, pathArray) {
  let node = root;
  for (const key of pathArray) {
    if (isSensitiveKey(key)) return true;
    const isObject = isContainer(node) && !Array.isArray(node);
    if (isObject && typeof key === 'string' && VALUE_FIELDS.has(fieldName(key)) && namesSecret(node)) return true;
    node = isContainer(node) && Object.prototype.hasOwnProperty.call(node, key) ? node[key] : undefined;
  }
  return false;
}

/** `value`, found at `pathArray` in `root`, with secrets masked (see redactValue). */
export function redactAt(root, pathArray, value, counter) {
  const key = pathArray[pathArray.length - 1];
  return redactValue(value, typeof key === 'string' ? key : undefined, counter, isSensitivePath(root, pathArray));
}

/** The keys of a path with the secret-looking ones (a token used as a key) masked. */
export function redactPathKeys(pathArray, counter) {
  return pathArray.map((key) => {
    if (!looksLikeSecret(key)) return key;
    counter.count += 1;
    return REDACTED;
  });
}

// ─── Raw text: error excerpts and repair diffs, which may be broken JSON, JSONC or Python-ish ───

const isWordChar = (code) =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36 || code === 45 || code === 43 || code === 46;
const isSpace = (code) => code === 32 || code === 9 || code === 13 || code === 10;
const LITERALS = new Set(['true', 'false', 'null', 'True', 'False', 'None', 'NaN', 'Infinity', '-Infinity', '+Infinity', 'undefined']);

/**
 * Splits JSON-like text into strings (either quote, unterminated ones end at the line break),
 * comments, words (numbers, literals, bare names), whitespace and single punctuation characters.
 */
function tokenize(text) {
  const tokens = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const start = i;
    const char = text[i];
    const code = text.charCodeAt(i);
    let type;
    if (char === '"' || char === "'") {
      i += 1;
      while (i < n && text[i] !== char && text[i] !== '\n') i += text[i] === '\\' && text[i + 1] !== '\n' ? 2 : 1;
      if (text[i] === char) i += 1;
      type = 'string';
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i += 1;
      type = 'comment';
    } else if (char === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
      type = 'comment';
    } else if (isWordChar(code)) {
      while (i < n && isWordChar(text.charCodeAt(i))) i += 1;
      type = 'word';
    } else if (isSpace(code)) {
      while (i < n && isSpace(text.charCodeAt(i))) i += 1;
      type = 'space';
    } else {
      i += 1;
      type = 'punct';
    }
    tokens.push({ type, start, end: Math.min(i, n), text: text.slice(start, Math.min(i, n)) });
  }
  return tokens;
}

/** The index of the next token that is not whitespace or a comment, or -1. */
function nextSignificant(tokens, index) {
  for (let next = index + 1; next < tokens.length; next += 1) {
    if (tokens[next].type !== 'space' && tokens[next].type !== 'comment') return next;
  }
  return -1;
}

/** The name a key token spells: the contents of a quoted string (unescaped when possible) or the bare word. */
function tokenName(token) {
  if (token.type !== 'string') return token.text;
  const quote = token.text[0];
  const inner = token.text.slice(1, token.text.length > 1 && token.text.endsWith(quote) ? -1 : undefined);
  if (quote === '"') {
    try {
      return JSON.parse(`"${inner}"`);
    } catch {
      return inner;
    }
  }
  return inner;
}

const isKeyToken = (tokens, index) => {
  const next = nextSignificant(tokens, index);
  return next !== -1 && tokens[next].text === ':';
};

function maskedToken(token) {
  if (token.type !== 'string') return REDACTED;
  const quote = token.text[0];
  return `${quote}${REDACTED}${token.text.length > 1 && token.text.endsWith(quote) ? quote : ''}`;
}

function redactPatterns(text) {
  let result = text;
  for (const pattern of SECRET_VALUE_PATTERNS) result = result.replace(new RegExp(pattern.source, `${pattern.flags}g`), REDACTED);
  return result;
}

/**
 * Masks secrets in raw (possibly broken) JSON text such as a whole document before a repair:
 * values under sensitive keys (following nesting across lines), values of settings with a
 * sensitive name, and secret-looking strings, keys and comments. The line structure is kept.
 */
export function redactText(text) {
  const tokens = tokenize(text);
  const masked = new Uint8Array(tokens.length);
  const values = []; // indices of scalar value tokens, in order
  const hideRange = (from, to) => {
    // Every scalar value token between two token indices (inclusive).
    let low = 0;
    let high = values.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (values[mid] < from) low = mid + 1;
      else high = mid;
    }
    for (let index = low; index < values.length && values[index] <= to; index += 1) masked[values[index]] = 1;
  };
  const top = { sensitive: false, isObject: false, entries: [], key: null };
  const stack = [];
  let frame = top;
  const close = (end) => {
    if (frame.isObject && frame.entries.some((entry) => NAME_FIELDS.has(fieldName(entry.name)) && isSensitiveKey(entry.text))) {
      frame.entries.filter((entry) => VALUE_FIELDS.has(fieldName(entry.name))).forEach((entry) => hideRange(entry.start, entry.end));
    }
    const parent = stack.pop();
    if (parent.opened !== undefined && parent.isObject && parent.key !== null) parent.entries.push({ name: parent.key.name, start: parent.opened, end });
    parent.key = null;
    parent.opened = undefined;
    frame = parent;
  };

  tokens.forEach((token, index) => {
    if (token.type === 'string' || token.type === 'word') {
      if (isKeyToken(tokens, index)) {
        const name = tokenName(token);
        frame.key = { name, sensitive: isSensitiveKey(name) };
        if (looksLikeSecret(name)) masked[index] = 1;
        return;
      }
      if (token.type === 'word' && LITERALS.has(token.text)) {
        if (frame.isObject && frame.key) frame.entries.push({ name: frame.key.name, start: index, end: index });
        frame.key = null;
        return;
      }
      values.push(index);
      if (frame.sensitive || frame.key?.sensitive || looksLikeSecret(tokenName(token))) masked[index] = 1;
      if (frame.isObject && frame.key) frame.entries.push({ name: frame.key.name, start: index, end: index, text: tokenName(token) });
      frame.key = null;
    } else if (token.text === '{' || token.text === '[') {
      frame.opened = index;
      stack.push(frame);
      frame = { sensitive: frame.sensitive || Boolean(frame.key?.sensitive), isObject: token.text === '{', entries: [], key: null };
    } else if ((token.text === '}' || token.text === ']') && stack.length > 0) {
      close(index);
    } else if (token.text === ',') {
      frame.key = null;
    }
  });
  while (stack.length > 0) close(tokens.length - 1);

  return tokens.map((token, index) => (masked[index] ? maskedToken(token) : token.type === 'comment' ? redactPatterns(token.text) : token.text)).join('');
}

const VALUE_MASK = '***';

/**
 * One line of raw text with every value hidden (strings, numbers, bare words and comments; keys,
 * punctuation and true/false/null stay), for error excerpts that show where a problem is without
 * showing data. `caret` is an index into the line; the result says where it lands in the masked line.
 */
export function maskValues(line, caret = -1) {
  const tokens = tokenize(line);
  let text = '';
  let moved = caret;
  tokens.forEach((token, index) => {
    let shown = token.text;
    if (token.type === 'string' || token.type === 'word') {
      if (isKeyToken(tokens, index)) {
        if (looksLikeSecret(tokenName(token))) shown = token.type === 'string' ? `${token.text[0]}${VALUE_MASK}${token.text[0]}` : VALUE_MASK;
      } else if (!(token.type === 'word' && LITERALS.has(token.text))) {
        const quote = token.type === 'string' ? token.text[0] : '';
        const closed = token.type === 'string' && token.text.length > 1 && token.text.endsWith(quote);
        shown = `${quote}${VALUE_MASK}${closed ? quote : ''}`;
      }
    } else if (token.type === 'comment') {
      shown = token.text.startsWith('//') ? `// ${VALUE_MASK}` : `/* ${VALUE_MASK}${token.text.endsWith('*/') && token.text.length > 3 ? ' */' : ''}`;
    }
    if (caret >= token.start && caret < token.end) moved = text.length + (shown === token.text ? caret - token.start : 0);
    text += shown;
  });
  if (caret >= line.length) moved = text.length + (caret - line.length);
  return { text, caret: moved };
}
