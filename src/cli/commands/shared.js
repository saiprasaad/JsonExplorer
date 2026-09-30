import path from 'node:path';
import { DIALECT_LABELS, detectDialect, parseDocument } from '../documents';
import { DEFAULT_MAX_SIZE_MB, readInput } from '../io';
import { UsageError } from '../args';
import { formatBytes, stringifyJson, truncate } from '../../utils/json';
import { CONCEALED } from '../jsonpath';
import { isSensitivePath, redactValue } from '../redact';

export const INPUT_OPTIONS = {
  jsonl: { type: 'boolean', description: 'Read the input as JSON Lines (one JSON value per line).' },
  jsonc: { type: 'boolean', description: 'Allow comments and trailing commas (JSONC).' },
  strict: { type: 'boolean', description: 'Read the input as strict JSON even if its name suggests JSONC.' },
  'max-size': { type: 'number', description: `Largest file to load whole, in MB (default ${DEFAULT_MAX_SIZE_MB}).` },
};

export const SECRET_OPTION = {
  'show-secrets': { type: 'boolean', description: 'Show values that look like secrets instead of [REDACTED].' },
};

/** The input dialect: from --jsonl / --jsonc / --strict, else guessed from the file name. */
export function dialectFor(file, values) {
  const flags = ['jsonl', 'jsonc', 'strict'].filter((flag) => values[flag]);
  if (flags.length > 1) throw new UsageError('Use only one of --jsonl, --jsonc and --strict.');
  const forced = flags[0] === 'strict' ? 'json' : flags[0];
  return detectDialect(file === '-' ? '' : file, forced);
}

export function readFile(file, values, ctx) {
  const maxSizeMb = values['max-size'] ?? DEFAULT_MAX_SIZE_MB;
  if (!(maxSizeMb > 0)) throw new UsageError('--max-size expects a number of MB greater than 0.');
  return readInput(file, { cwd: ctx.cwd, stdin: ctx.stdin, maxSizeMb });
}

/**
 * Reads and parses a whole document; throws DocumentError (with a code excerpt) if it is invalid.
 * With `skipInvalidLines`, broken JSON Lines records are left out (and reported) instead.
 */
export async function loadDocument(file, values, ctx, { skipInvalidLines = false } = {}) {
  const input = await readFile(file, values, ctx);
  const dialect = dialectFor(file, values);
  const document = { input, dialect, ...parseDocument(input, dialect, { showSecrets: Boolean(values['show-secrets']), skipInvalidLines }) };
  precisionNote(document, ctx);
  if (document.skipped?.length > 0) ctx.err(skippedNote(document.skipped));
  return document;
}

/**
 * Numbers such as 12345678901234567890 or 1.50 are kept exactly as written, except (on engines
 * without JSON.parse source text access, like Node.js before 21) in documents nested too deeply
 * for the exact parse: say so, once per run, when a parse `result` was rounded.
 */
export function precisionNote(result, ctx) {
  if (ctx.precisionNoted || !result.rounded) return;
  ctx.precisionNoted = true;
  ctx.err('Note: this document is nested too deeply to keep numbers such as 12345678901234567890 or 1.50 exactly as written here; results may show them rounded. Node.js 22 or later keeps them exact.');
}

/** "Note: 2 invalid lines skipped (first: line 7, column 3: …)." */
export function skippedNote(errors, count = errors.length) {
  const [first] = errors;
  return `Note: ${plural(count, 'invalid line')} skipped (first at line ${first.line}, column ${first.column}: ${first.message}).`;
}

/**
 * Text for a terminal: control characters in data (escape sequences that recolour the screen,
 * retitle the window or write the clipboard) are shown as \u escapes. Only when stdout is a
 * terminal: piped output stays exactly as the data is.
 */
export function forTerminal(text, ctx) {
  // eslint-disable-next-line no-control-regex
  return ctx.stdoutIsTTY ? text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`) : text;
}

export function expectPositionals(positionals, min, max, usage) {
  if (positionals.length < min || positionals.length > max) throw new UsageError(`Usage: json-explorer ${usage}`);
}

export function plural(count, noun, pluralNoun = `${noun}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? noun : pluralNoun}`;
}

export function lastKey(pathArray) {
  const key = pathArray?.[pathArray.length - 1];
  return typeof key === 'string' ? key : undefined;
}

/**
 * Options for evaluating a JSONPath, so that filters cannot probe what the output masks: unless
 * secrets are shown, a filter reads a sensitive or secret-looking value as if it were not there
 * (and an object or array without such parts). Otherwise [?@ == 'guess'], match(), length() or a
 * count of matches would confirm a masked value.
 */
export function filterOptions(showSecrets) {
  if (showSecrets) return {};
  return { conceal: (root, pathArray, value) => redactValue(value, lastKey(pathArray), { count: 0 }, isSensitivePath(root, pathArray), CONCEALED) };
}

/**
 * A value as compact JSON for a one-line preview, secret-looking values masked unless shown.
 * `key` is the member name it sits under and `inherited` whether a key above it is sensitive.
 */
export function preview(value, { max = 100, counter, showSecrets = false, key, inherited = false }) {
  const shown = showSecrets ? value : redactValue(value, key, counter, inherited);
  return truncate(stringifyJson(shown), max);
}

export function secretsNote(counter) {
  if (counter.count === 0) return '';
  const one = counter.count === 1;
  return `${plural(counter.count, 'value')} hidden because ${one ? 'it looks' : 'they look'} like ${one ? 'a secret' : 'secrets'}; add --show-secrets to reveal ${one ? 'it' : 'them'}.`;
}

export function describeInput(input, dialect) {
  return `${input.name} · ${DIALECT_LABELS[dialect]} · ${formatBytes(input.bytes)}`;
}

/**
 * The permissions for a file derived from an input: the owner can read and write it, and others
 * get no more access than they have to the input (a private file stays private). Data from stdin
 * could be anything, so what is derived from it is private.
 */
export function derivedMode(input) {
  return input.mode === null ? 0o600 : (input.mode & 0o066) | 0o600;
}

/** A path relative to the working directory when inside it (shorter to read), else absolute. */
export function displayPath(target, cwd) {
  const relative = path.relative(cwd, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : target;
}

/** "--indent 2|4|tab|<n>" → a formatJson indent. */
export function parseIndent(raw) {
  if (raw === undefined) return 2;
  if (raw === 'tab' || raw === '\t') return '\t';
  const size = Number(raw);
  if (!Number.isInteger(size) || size < 0 || size > 10) throw new UsageError(`--indent expects 0–10 or "tab", got "${raw}".`);
  return size;
}
