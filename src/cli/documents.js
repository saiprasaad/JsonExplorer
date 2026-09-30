import { createScanner, parse as parseWithErrors, SyntaxKind, visit } from 'jsonc-parser';
import { describeJsonError, JSONC_OPTIONS, numberKey, offsetToLineColumn, parseJson, RawNumber } from '../utils/json';
import { maskValues } from './redact';

/*
 * Documents come in three dialects: JSON, JSONC (JSON with comments and trailing commas, used by
 * tsconfig.json or VS Code settings) and JSON Lines (one JSON value per line, e.g. logs and datasets).
 */

const JSONL_FILES = /\.(jsonl|ndjson|jsonlines)$/i;
// Files that are JSON with comments by convention: tsconfig, VS Code (workspace and user) settings,
// devcontainers, and the tools that read their JSON config that way. viewer.py has the same list.
const JSONC_FILES = /(\.jsonc|(^|[\\/])(tsconfig|jsconfig)(\.[\w.-]+)?\.json|(^|[\\/])\.vscode[\\/][^\\/]+\.json|(^|[\\/])\.?devcontainer(-feature)?\.json|(^|[\\/])\.eslintrc\.json|(^|[\\/])(deno|turbo|biome|tslint|typedoc|api-extractor|nx|\.?cspell|\.markdownlint|\.oxlintrc|babel\.config|\.babelrc)\.json|(^|[\\/])(Code|Code - Insiders|VSCodium|Cursor|Windsurf)[\\/]User[\\/].+\.json|(^|[\\/])zed[\\/](settings|keymap|tasks)\.json|(^|[\\/])LocalState[\\/]settings\.json)$/i;

/** The dialect of a file: forced by a flag, else guessed from its name. */
export function detectDialect(name, forced) {
  if (forced) return forced;
  if (JSONL_FILES.test(name)) return 'jsonl';
  if (JSONC_FILES.test(name)) return 'jsonc';
  return 'json';
}

export const DIALECT_LABELS = { json: 'JSON', jsonc: 'JSON with comments', jsonl: 'JSON Lines' };

/** A document that failed to parse, with a friendly message and a location. */
export class DocumentError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DocumentError';
    Object.assign(this, details);
  }
}

/** Control characters would act on the terminal (colours, titles, the clipboard): show them as '?'. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * An excerpt of the text around a line/column with a caret, like a compiler error. Values are
 * hidden (strings, numbers, bare words, comments) unless `showSecrets`, so an excerpt shows where
 * a problem is without showing data. Very long lines (minified JSON) are windowed around the column.
 */
export function codeFrame(text, line, column, { context = 2, width = 100, showSecrets = false, lineOffset = 0 } = {}) {
  const first = Math.max(1, line - context);
  const last = line + context;
  const rows = [];
  let current = 1;
  let start = 0;
  while (current < first) {
    const next = text.indexOf('\n', start);
    if (next === -1) return ''; // The text ends before the excerpt would start.
    start = next + 1;
    current += 1;
  }
  const gutter = String(last + lineOffset).length;
  while (current <= last && start <= text.length) {
    const end = text.indexOf('\n', start);
    let content = text.slice(start, end === -1 ? text.length : end).replace(/\r$/, '');
    let caret = current === line ? column - 1 : -1;
    if (!showSecrets) ({ text: content, caret } = maskValues(content, caret));
    if (content.length > width) {
      const from = current === line ? Math.max(0, Math.min(caret - Math.floor(width / 2), content.length - width)) : 0;
      const prefix = from > 0 ? '…' : '';
      content = `${prefix}${content.slice(from, from + width)}${from + width < content.length ? '…' : ''}`;
      caret = caret - from + prefix.length;
    }
    content = content.replace(/\t/g, ' ').replace(CONTROL_CHARACTERS, '?');
    const marker = current === line ? '>' : ' ';
    rows.push(`${marker} ${String(current + lineOffset).padStart(gutter)} | ${content}`);
    if (current === line) rows.push(`  ${' '.repeat(gutter)} | ${' '.repeat(Math.max(0, caret))}^`);
    if (end === -1) break;
    start = end + 1;
    current += 1;
  }
  return rows.join('\n');
}

/**
 * JSONC → JSON: drops comments and trailing commas, keeping every token exactly as written.
 * Only call this on text that parsed as JSONC.
 */
export function jsoncToJson(text) {
  const scanner = createScanner(text, true);
  const tokens = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EOF; kind = scanner.scan()) {
    const closes = kind === SyntaxKind.CloseBraceToken || kind === SyntaxKind.CloseBracketToken;
    if (closes && tokens[tokens.length - 1] === ',') tokens.pop();
    tokens.push(text.substr(scanner.getTokenOffset(), scanner.getTokenLength()));
  }
  return tokens.join('');
}

/** Parses one JSON or JSONC text exactly. Returns `{ ok, value, json }` or `{ ok: false, empty, error }`. */
export function parseText(text, dialect) {
  if (dialect === 'jsonc') {
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    if (!body.trim()) return { ok: false, empty: true, error: null };
    const errors = [];
    parseWithErrors(body, errors, JSONC_OPTIONS);
    if (errors.length > 0) {
      const error = describeJsonError(body, null, JSONC_OPTIONS);
      return { ok: false, empty: false, error };
    }
    const json = jsoncToJson(body);
    const parsed = parseJson(json, { exact: true });
    return { ok: true, value: parsed.value, json, rounded: parsed.rounded };
  }
  const result = parseJson(text, { exact: true });
  return result.ok ? { ...result, json: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text } : result;
}

/** Parses one line of a JSON Lines file. Blank lines are allowed and reported as `blank`. */
export function parseLine(line, number) {
  if (!line.trim()) return { blank: true };
  const result = parseJson(line, { exact: true });
  if (result.ok) return { ok: true, value: result.value, rounded: result.rounded };
  return { ok: false, error: { ...result.error, line: number, recordLine: number } };
}

/**
 * Parses a whole document (for commands that need it in memory). JSON Lines become an array of
 * records, and `json` is always plain JSON text for the document (JSONC comments removed).
 * Throws DocumentError for invalid input.
 */
export function parseDocument(input, dialect, { showSecrets = false, skipInvalidLines = false } = {}) {
  const { text, name } = input;
  if (dialect === 'jsonl') {
    const values = [];
    const texts = [];
    const skipped = [];
    let rounded;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = index === 0 && lines[0].charCodeAt(0) === 0xfeff ? lines[0].slice(1) : lines[index];
      const parsed = parseLine(line, index + 1);
      if (parsed.blank) continue;
      if (!parsed.ok && skipInvalidLines) {
        skipped.push(parsed.error);
        continue;
      }
      if (!parsed.ok) {
        const { message, line: lineNumber, column } = parsed.error;
        throw new DocumentError(
          `${name} is not valid JSON Lines: line ${lineNumber}, column ${column}: ${message}\n${codeFrame(line, 1, column, { context: 0, showSecrets, lineOffset: lineNumber - 1 })}`,
          { line: lineNumber, column }
        );
      }
      values.push(parsed.value);
      texts.push(line.trim());
      rounded ||= parsed.rounded;
    }
    return { value: values, json: `[${texts.join(',\n')}]`, records: values.length, skipped, rounded };
  }
  const result = parseText(text, dialect);
  if (!result.ok) {
    if (result.empty) throw new DocumentError(`${name} is empty.`);
    const { message, line, column } = result.error;
    const hint = dialect === 'json' && /\.json5$/i.test(name) ? ' JSON5 is not JSON: run `repair` to convert it.' : '';
    throw new DocumentError(
      `${name} is not valid ${DIALECT_LABELS[dialect]}: ${message} (line ${line}, column ${column}).${hint}\n${codeFrame(text, line, column, { showSecrets })}`,
      { line, column }
    );
  }
  return { value: result.value, json: result.json, rounded: result.rounded };
}

/**
 * Warnings about valid JSON: duplicate keys (parsers disagree on which value wins) and numbers
 * that lose precision as double-precision floats (JavaScript and many other languages).
 */
export function findWarnings(text, { jsonc = false, limit = 20, lineOffset = 0 } = {}) {
  const warnings = [];
  const keySets = [];
  let imprecise = 0;
  let firstImprecise = null;
  const where = (offset) => {
    const { line, column } = offsetToLineColumn(text, offset);
    return { line: line + lineOffset, column };
  };
  try {
    visit(
      text,
      {
        onObjectBegin: () => keySets.push(new Set()),
        onObjectEnd: () => keySets.pop(),
        onArrayBegin: () => keySets.push(null),
        onArrayEnd: () => keySets.pop(),
        onObjectProperty: (name, offset) => {
          const keys = keySets[keySets.length - 1];
          if (keys.has(name)) {
            if (warnings.length < limit) {
              warnings.push({ kind: 'duplicate-key', ...where(offset), message: `Duplicate key ${JSON.stringify(name)}: most parsers keep only the last value.` });
            }
          } else {
            keys.add(name);
          }
        },
        onLiteralValue: (value, offset, length) => {
          if (typeof value !== 'number') return;
          const literal = text.substr(offset, length);
          if (numberKey(new RawNumber(literal)) === numberKey(value)) return;
          imprecise += 1;
          if (!firstImprecise) firstImprecise = where(offset);
        },
      },
      jsonc ? JSONC_OPTIONS : { disallowComments: true, allowTrailingComma: false }
    );
  } catch {
    // Nesting too deep for the detailed scan: skip the warnings.
  }
  if (imprecise > 0) {
    warnings.push({
      kind: 'imprecise-number',
      line: firstImprecise.line,
      column: firstImprecise.column,
      message: `${imprecise.toLocaleString('en-US')} number${imprecise === 1 ? '' : 's'} cannot be represented exactly as double-precision floats (JavaScript and many JSON libraries would round ${imprecise === 1 ? 'it' : 'them'})${imprecise === 1 ? '' : '; the first is on this line'}.`,
    });
  }
  return warnings;
}
