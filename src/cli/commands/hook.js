import fs from 'node:fs';
import path from 'node:path';
import { codeFrame, detectDialect, DIALECT_LABELS, parseLine, parseText } from '../documents';
import { decodeBuffer, readStreamBytes, toReadable } from '../io';

/*
 * A Claude Code PostToolUse hook: after Claude writes or edits a JSON-family file, check it and,
 * if the edit broke it, tell Claude where (exit code 2 feeds stderr back to Claude). Silent when
 * the file is fine, not JSON, or was already broken before the edit. The excerpt it shows hides
 * every value, since whatever it prints lands in the conversation. Any problem in the hook itself
 * never blocks work (exit 0).
 */

const JSON_FILES = /\.(json|jsonc|jsonl|ndjson|geojson|topojson|har|webmanifest|jsonld)$/i;
const MAX_BYTES = 10 * 1024 * 1024;
// Write and Edit events carry the file's content (and, after an edit, its previous content).
const MAX_EVENT_BYTES = 64 * 1024 * 1024;

/** The first syntax problem in the text (without an excerpt), or null. */
function firstProblem(text, dialect) {
  if (dialect === 'jsonl') {
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = index === 0 ? lines[0].replace(/^﻿/, '') : lines[index];
      const parsed = parseLine(line, index + 1);
      if (parsed.ok === false) return { ...parsed.error, excerpt: () => codeFrame(line, 1, parsed.error.column, { context: 0, lineOffset: index }) };
    }
    return null;
  }
  const parsed = parseText(text, dialect);
  if (parsed.ok) return null;
  if (parsed.empty) return { message: 'the file is empty', line: 1, column: 1, excerpt: () => '' };
  return { ...parsed.error, excerpt: () => codeFrame(text, parsed.error.line, parsed.error.column) };
}

/** A file name as one printable line (a name could otherwise carry line breaks or terminal codes). */
// eslint-disable-next-line no-control-regex
const printable = (text) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?');

/** A POSIX shell word for `text`, or null when it cannot be shown safely on one line. */
function shellQuote(text) {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(text)) return null;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

export const hook = {
  name: 'hook',
  summary: 'Claude Code hook: report JSON files that an edit left invalid (internal)',
  usage: 'hook   (reads the hook event as JSON on stdin)',
  description: ['Used by the JSON Explorer plugin after Write/Edit. Set JSON_EXPLORER_HOOK=off to disable it.'],
  options: {},
  examples: [],
  hidden: true,

  async run(_, ctx) {
    if (ctx.env.JSON_EXPLORER_HOOK === 'off') return 0;
    try {
      const event = JSON.parse((await readStreamBytes(toReadable(ctx.stdin), MAX_EVENT_BYTES, 'stdin', 1)).toString('utf8'));
      const file = event?.tool_input?.file_path;
      if (typeof file !== 'string' || !JSON_FILES.test(file)) return 0;
      const absolute = path.resolve(typeof event.cwd === 'string' ? event.cwd : ctx.cwd, file);
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || stat.size > MAX_BYTES) return 0;
      const { text } = decodeBuffer(fs.readFileSync(absolute), file);
      const dialect = detectDialect(file);
      const problem = firstProblem(text, dialect);
      if (!problem) return 0;

      // The file as it was before an edit: if it was already broken, this edit is not to blame.
      const original = event.tool_response?.originalFile;
      const before = typeof original === 'string' && original.trim() !== '' ? original : null;
      if (before !== null && firstProblem(before, dialect)) return 0;
      // Comments in a .json file that is otherwise fine: it may be JSONC in practice (VS Code settings).
      const commentsOnly = dialect === 'json' && /^Comments are not allowed/.test(problem.message) && parseText(text, 'jsonc').ok;

      const name = printable(file);
      const lines = [`JSON Explorer: ${name} is not valid ${DIALECT_LABELS[dialect]} after this edit: ${problem.message} (line ${problem.line}, column ${problem.column}).`, problem.excerpt()];
      if (commentsOnly) {
        lines.push('If this file is meant to allow comments (JSONC, like tsconfig.json or VS Code settings), leave it as it is; otherwise remove them.');
      } else if (dialect === 'json') {
        const script = shellQuote(ctx.scriptPath);
        const target = shellQuote(absolute);
        lines.push(
          script && target
            ? `Fix the file. To see how common mistakes would be repaired: node ${script} repair ${target} --diff`
            : 'Fix the file. To see how common mistakes would be repaired, run json-explorer repair on it with --diff.'
        );
      } else {
        lines.push('Fix the file.');
      }
      ctx.err(lines.filter(Boolean).join('\n'));
      return 2;
    } catch {
      return 0;
    }
  },
};
