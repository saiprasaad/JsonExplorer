import path from 'node:path';
import { jsonrepair } from 'jsonrepair';
import { formatJson, minifyJson, parseJson, stringifyJson } from '../../utils/json';
import { UsageError } from '../args';
import { DIALECT_LABELS, DocumentError, parseText } from '../documents';
import { encodeLike, writeFileAtomic } from '../io';
import { redactText } from '../redact';
import { changeSnippets, countChanges, diffSequences, unifiedDiff } from '../textdiff';
import { derivedMode, dialectFor, displayPath, expectPositionals, INPUT_OPTIONS, parseIndent, plural, readFile, SECRET_OPTION } from './shared';

const USAGE = 'repair <file> [-o <out> | -i] [--diff] [--indent 2|4|tab]';

/** The text without trailing spaces and tabs (a loop: /[ \t]+$/ backtracks on long runs of blanks). */
function trimBlanks(text) {
  let end = text.length;
  while (end > 0 && (text[end - 1] === ' ' || text[end - 1] === '\t')) end -= 1;
  return text.slice(0, end);
}

/**
 * Removes comments that start a line or follow whitespace (outside quoted strings), with the
 * blanks before them; lines left empty go too. Comments elsewhere, like the "//" of an unquoted
 * URL, are left to jsonrepair, which knows them apart.
 */
export function stripComments(text) {
  const lines = [];
  let line = '';
  let quote = null;
  let lineHadComment = false;
  const endLine = (newline) => {
    if (!(lineHadComment && !line.trim())) lines.push(line + newline);
    line = '';
    lineHadComment = false;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      line += char;
      if (char === '\\' && index + 1 < text.length) line += text[(index += 1)];
      else if (char === quote || char === '\n') quote = null;
      if (char === '\n') {
        line = line.slice(0, -1);
        endLine('\n');
      }
      continue;
    }
    const opensComment = char === '/' && (text[index + 1] === '/' || text[index + 1] === '*') && (line.trim() === '' || /[ \t]$/.test(line));
    if (opensComment) {
      line = trimBlanks(line);
      lineHadComment = true;
      if (text[index + 1] === '/') {
        while (index + 1 < text.length && text[index + 1] !== '\n' && text[index + 1] !== '\r') index += 1;
      } else {
        const end = text.indexOf('*/', index + 2);
        const comment = text.slice(index, end === -1 ? text.length : end + 2);
        // Line breaks inside the comment end lines that held nothing else.
        comment.split('\n').slice(1).forEach(() => endLine('\n'));
        lineHadComment = true;
        index = end === -1 ? text.length : end + 1;
      }
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    if (char === '\n') {
      const carriage = line.endsWith('\r') ? '\r' : '';
      line = line.slice(0, line.length - carriage.length);
      endLine(`${carriage}\n`);
      continue;
    }
    line += char;
  }
  if (line || !lineHadComment) lines.push(line);
  return lines.join('');
}

/**
 * Where the comments are: those that start a line or follow whitespace, outside quoted strings
 * (the ones stripComments removes). Each span is [start, end) and excludes the line break.
 */
export function commentSpans(text) {
  const spans = [];
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote || char === '\n') quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '/' && (text[index + 1] === '/' || text[index + 1] === '*') && (index === 0 || /\s/.test(text[index - 1]))) {
      let end;
      if (text[index + 1] === '/') {
        end = index;
        while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end += 1;
      } else {
        const close = text.indexOf('*/', index + 2);
        end = close === -1 ? text.length : close + 2;
      }
      spans.push([index, end]);
      index = end - 1;
    }
  }
  return spans;
}

/**
 * Repairs JSON with comments (JSONC) and keeps the comments: the comments are blanked out, the
 * rest repaired, and the repair's edits applied to the original text. Null when an edit would
 * touch a comment or the result does not hold the same data.
 */
export function repairKeepingComments(text) {
  const spans = commentSpans(text);
  if (spans.length === 0) return null;
  const chars = text.split('');
  spans.forEach(([start, end]) => {
    for (let index = start; index < end; index += 1) if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
  });
  let repaired;
  try {
    repaired = jsonrepair(chars.join(''));
  } catch {
    return null;
  }
  const ops = diffSequences(chars, repaired.split(''));
  if (ops === null) return null;
  const inside = (position) => spans.some(([start, end]) => position > start && position < end);
  const overlaps = (from, to) => spans.some(([start, end]) => from < end && to > start);
  let result = '';
  for (const { type, a, b, count } of ops) {
    if (type === 'equal') result += text.slice(a, a + count);
    else if (type === 'delete' ? overlaps(a, a + count) : inside(a)) return null;
    else if (type === 'insert') result += repaired.slice(b, b + count);
  }
  const kept = parseText(result, 'jsonc');
  return kept.ok && stringifyJson(kept.value) === stringifyJson(parseJson(repaired, { exact: true }).value) ? result : null;
}

function repairText(text, name) {
  // Removing comments first keeps the layout clean; jsonrepair would leave their blank lines.
  const stripped = stripComments(text);
  try {
    return jsonrepair(stripped);
  } catch {
    // Comment stripping may have gone wrong on unusual text: let jsonrepair have the original.
  }
  try {
    return jsonrepair(text);
  } catch (error) {
    throw new DocumentError(`${name} could not be repaired automatically: ${error.message}. Run validate to see the first problem.`);
  }
}

/**
 * What changed, readable: a unified diff, or snippets for a file on one line or with very long
 * lines (minified). Secrets are masked unless `showSecrets`: in the whole documents first, so that
 * however the changes are cut into hunks, a secret is recognised by the key it sits under.
 */
export function describeChanges(before, after, { from, to, showSecrets = false }) {
  const left = showSecrets ? before : redactText(before);
  const right = showSecrets ? after : redactText(after);
  const lines = left.replace(/\r?\n$/, '').split('\n');
  const inline = lines.length === 1 || lines.some((line) => line.length > 400);
  const text = inline ? changeSnippets(left, right) : unifiedDiff(left, right, { from, to });
  return text ?? 'The changes are too extensive to list (the document was largely rewritten).';
}

export const repair = {
  name: 'repair',
  summary: 'Fix common mistakes: quotes, commas, comments, Python literals, truncation…',
  usage: USAGE,
  description: [
    'Turns almost-JSON into valid JSON: single quotes, unquoted keys, trailing or missing commas,',
    'comments, Python None/True/False, NaN, JSONP wrappers, unclosed brackets, and more. Values are',
    'kept as written. Prints the repaired JSON (or writes it with -o / -i); --diff shows what changed.',
    'JSON Lines files are repaired line by line.',
  ],
  options: {
    out: { type: 'string', alias: 'o', description: 'Write the repaired JSON to this file.' },
    'in-place': { type: 'boolean', alias: 'i', description: 'Fix the file itself (written atomically).' },
    diff: { type: 'boolean', description: 'Show what was changed (instead of printing the JSON, unless -o/-i). Secrets are masked.' },
    indent: { type: 'string', description: 'Also pretty-print the result: 2, 4, tab or 0 (minified).' },
    ...SECRET_OPTION,
    ...INPUT_OPTIONS,
  },
  examples: ['repair broken.json --diff', 'repair broken.json -i', 'repair - < broken.txt > fixed.json'],

  async run({ values, positionals }, ctx) {
    expectPositionals(positionals, 1, 1, USAGE);
    const [file] = positionals;
    if (values.out && values['in-place']) throw new UsageError('Use either -o <file> or -i, not both.');
    if (values['in-place'] && file === '-') throw new UsageError('-i needs a file (stdin cannot be edited in place).');
    const indent = values.indent === undefined ? undefined : parseIndent(values.indent);
    const input = await readFile(file, values, ctx);
    const dialect = dialectFor(file, values);
    const body = input.text;
    let repaired;

    if (!body.trim()) throw new DocumentError(`${input.name} is empty; there is nothing to repair.`);
    if (dialect === 'jsonl') {
      if (indent !== undefined) throw new UsageError('--indent does not apply to JSON Lines: each record stays on one line.');
      let fixed = 0;
      repaired = body
        .split(/\r?\n/)
        .map((line, index) => {
          if (!line.trim() || parseText(line, 'json').ok) return line;
          fixed += 1;
          // Each record must stay on one line.
          return minifyJson(repairText(line, `${input.name} line ${index + 1}`));
        })
        .join('\n');
      if (fixed === 0) {
        ctx.err(`${input.name} is already valid JSON Lines; nothing to repair.`);
        return 0;
      }
    } else {
      if (parseText(body, dialect).ok) {
        ctx.err(`${input.name} is already valid ${DIALECT_LABELS[dialect]}; nothing to repair.`);
        return 0;
      }
      // JSON with comments keeps them when the repair can work around them.
      const withComments = dialect === 'jsonc' && indent === undefined ? repairKeepingComments(body) : null;
      if (withComments !== null) {
        repaired = withComments;
      } else {
        repaired = repairText(body, input.name);
        if (!parseJson(repaired).ok) throw new DocumentError(`${input.name} could not be fully repaired.`);
        const comments = commentSpans(body).length;
        if (comments > 0 && dialect === 'jsonc') {
          if (values['in-place']) {
            throw new UsageError(
              `Repairing ${input.name} would remove its comments. Use -o <file> to write the repaired JSON without them, or fix the problem by hand (validate shows where it is).`
            );
          }
          ctx.err(`Note: the repaired JSON has no comments: they could not be kept around this repair.`);
        } else if (comments > 0) {
          ctx.err(`Note: ${plural(comments, 'comment')} removed, since JSON does not allow comments. If ${input.name} is meant to have them (JSONC), repair it with --jsonc to keep them.`);
        }
        if (indent !== undefined) repaired = formatJson(repaired, indent);
      }
    }

    const changes = countChanges(body, repaired);
    const changeText = changes === null ? 'many changes' : plural(changes, 'change');
    const diffText = values.diff ? describeChanges(body, repaired, { from: input.name, to: `${input.name} (repaired)`, showSecrets: Boolean(values['show-secrets']) }) : null;
    if (values['in-place'] || values.out) {
      const target = values['in-place'] ? input.path : path.resolve(ctx.cwd, values.out);
      const written = values['in-place']
        ? writeFileAtomic(target, encodeLike(repaired, input))
        : writeFileAtomic(target, encodeLike(repaired, { bom: null, eol: input.eol }), { mode: derivedMode(input), inputs: [input.path] });
      ctx.out(`Repaired ${input.name} (${changeText}) → ${displayPath(written, ctx.cwd)}.`);
      if (diffText) ctx.out(diffText);
    } else if (diffText) {
      ctx.out(diffText);
      ctx.err(`${changeText} in total. Use -i to fix the file in place or -o <file> to save the result.`);
    } else {
      ctx.write(repaired.endsWith('\n') ? repaired : `${repaired}\n`);
      ctx.err(`Repaired ${input.name}: ${changeText}. Add --diff to see them, or -i to fix the file in place.`);
    }
    return 0;
  },
};
