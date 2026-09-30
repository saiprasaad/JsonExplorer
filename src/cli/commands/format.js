import path from 'node:path';
import { applyEdits, format as formatJsonc } from 'jsonc-parser';
import { formatJson, minifyJson, sortJsonKeys } from '../../utils/json';
import { UsageError } from '../args';
import { codeFrame, DIALECT_LABELS, DocumentError, jsoncToJson, parseLine, parseText } from '../documents';
import { encodeLike, writeFileAtomic } from '../io';
import { derivedMode, dialectFor, displayPath, INPUT_OPTIONS, parseIndent, plural, readFile } from './shared';

/*
 * format / minify / sort-keys rewrite the text token by token, so number literals (1.50,
 * 12345678901234567890), string escapes and key order (except when sorting) survive exactly.
 * Byte order marks and CRLF line endings are kept; a final newline is added unless disabled.
 */

function invalid(input, dialect, error) {
  return new DocumentError(
    `${input.name} is not valid ${DIALECT_LABELS[dialect]}: ${error.message} (line ${error.line}, column ${error.column}). Nothing was changed; fix it first (json-explorer repair ${input.name === 'stdin' ? '-' : input.name} --diff).\n${codeFrame(input.text, error.line, error.column)}`
  );
}

function transform(input, dialect, kind, { indent, finalNewline }) {
  // readInput already set any byte order mark aside (encodeLike puts it back).
  const body = input.text;
  let result;
  let note = null;
  if (dialect === 'jsonl') {
    result = body
      .split(/\r?\n/)
      .map((line, index) => {
        const parsed = parseLine(line, index + 1);
        if (parsed.blank) return null;
        if (!parsed.ok) throw invalid({ ...input, text: body }, dialect, parsed.error);
        return kind === 'sort-keys' ? sortJsonKeys(line, 0) : minifyJson(line);
      })
      .filter((line) => line !== null)
      .join('\n');
    if (kind === 'format') note = 'JSON Lines keeps one record per line, so each record was written compactly.';
  } else {
    const parsed = parseText(body, dialect);
    if (!parsed.ok) {
      if (parsed.empty) throw new DocumentError(`${input.name} is empty; nothing to format.`);
      throw invalid(input, dialect, parsed.error);
    }
    if (dialect === 'jsonc') {
      if (kind === 'sort-keys') throw new DocumentError(`Sorting keys would move or drop the comments in ${input.name}. Convert it to plain JSON first (json-explorer convert ${input.name} --to json).`);
      if (kind === 'minify') {
        result = jsoncToJson(body);
        note = 'Comments were removed (minified JSON has no room for them).';
      } else {
        if (indent === 0) throw new UsageError('--indent 0 would put everything on one line, with no room for comments: use minify to drop them, or an indent of 1 or more.');
        const edits = formatJsonc(body, undefined, { tabSize: indent === '\t' ? 1 : indent, insertSpaces: indent !== '\t', eol: '\n', keepLines: false });
        result = applyEdits(body, edits);
      }
    } else if (kind === 'minify') {
      result = minifyJson(body);
    } else if (kind === 'sort-keys') {
      result = sortJsonKeys(body, indent);
    } else {
      result = formatJson(body, indent);
    }
  }
  result = result.trimEnd();
  return { text: finalNewline && result ? `${result}\n` : result, note };
}

function makeCommand(kind, summary, description, examples) {
  const usage = `${kind} <file>... [-o <out> | -i | --check]${kind === 'minify' ? '' : ' [--indent 2|4|tab]'}`;
  return {
    name: kind,
    summary,
    usage,
    description,
    options: {
      ...(kind === 'minify' ? {} : { indent: { type: 'string', description: 'Indentation: a number of spaces (default 2) or "tab".' } }),
      out: { type: 'string', alias: 'o', description: 'Write the result to this file.' },
      'in-place': { type: 'boolean', alias: 'i', description: 'Rewrite the files themselves (atomically).' },
      check: { type: 'boolean', description: 'Change nothing; exit 1 if any file would change (for CI).' },
      'final-newline': { type: 'boolean', description: 'End with a newline (default; --no-final-newline to omit).' },
      ...INPUT_OPTIONS,
    },
    examples,

    async run({ values, positionals }, ctx) {
      if (positionals.length === 0) throw new UsageError(`Usage: json-explorer ${usage}`);
      const modes = ['out', 'in-place', 'check'].filter((mode) => values[mode] !== undefined && values[mode] !== false);
      if (modes.length > 1) throw new UsageError('Use only one of -o, -i and --check.');
      if (positionals.length > 1 && modes.length === 0) throw new UsageError('With several files, add -i to rewrite them or --check to test them.');
      if (positionals.length > 1 && values.out) throw new UsageError('-o takes a single input file.');
      if (values['in-place'] && positionals.includes('-')) throw new UsageError('-i needs files (stdin cannot be edited in place).');
      const options = { indent: parseIndent(values.indent), finalNewline: values['final-newline'] !== false };

      let pending = 0;
      for (const file of positionals) {
        const input = await readFile(file, values, ctx);
        const dialect = dialectFor(file, values);
        const { text, note } = transform(input, dialect, kind, options);
        const encoded = encodeLike(text, input);
        const unchanged = encoded.equals(input.buffer);
        if (values.check) {
          if (!unchanged) pending += 1;
          ctx.out(unchanged ? `✓ ${input.name}` : `✗ ${input.name} (would change)`);
        } else if (values['in-place']) {
          if (!unchanged) writeFileAtomic(input.path, encoded);
          ctx.out(`${unchanged ? '✓' : '✎'} ${input.name}${unchanged ? ' (unchanged)' : ''}`);
        } else if (values.out) {
          const written = writeFileAtomic(path.resolve(ctx.cwd, values.out), encoded, { mode: derivedMode(input), inputs: [input.path] });
          ctx.out(`Wrote ${displayPath(written, ctx.cwd)}.`);
        } else {
          ctx.write(text);
        }
        if (note && !values.check) ctx.err(`Note: ${note}`);
      }
      if (values.check && positionals.length > 1) ctx.out(`${plural(positionals.length - pending, 'file')} OK, ${pending} would change.`);
      return values.check && pending > 0 ? 1 : 0;
    },
  };
}

export const format = makeCommand(
  'format',
  'Pretty-print losslessly (numbers, escapes and key order untouched)',
  ['Re-indents JSON without re-serializing it: literals such as 1.50 or 12345678901234567890 stay', 'exactly as written. JSONC files keep their comments. Use --check in CI to verify formatting.'],
  ['format data.json -i', 'format *.json --check', 'format min.json --indent 4 -o pretty.json']
);

export const minify = makeCommand(
  'minify',
  'Remove all insignificant whitespace, losslessly',
  ['Writes the most compact JSON while keeping every literal exactly as written.'],
  ['minify data.json -o data.min.json', 'minify data.json -i']
);

export const sortKeys = makeCommand(
  'sort-keys',
  'Sort object keys recursively (code point order, like jq -S), losslessly',
  ['Sorts keys at every level for stable, diff-friendly files; array order and values are unchanged.'],
  ['sort-keys package-lock.json --check', 'sort-keys config.json -i']
);
