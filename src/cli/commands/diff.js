import path from 'node:path';
import { diffJson, withoutIgnored } from '../../utils/diff';
import { formatPath, stringifyJson } from '../../utils/json';
import { UsageError } from '../args';
import { buildViewerPage } from '../html';
import { compilePath } from '../jsonpath';
import { isSensitivePath, redactPathKeys, redactValue } from '../redact';
import { VERSION } from '../version';
import { defaultOutput, readTemplate, writePage } from './explore';
import { expectPositionals, filterOptions, INPUT_OPTIONS, lastKey, loadDocument, plural, preview, secretsNote, SECRET_OPTION } from './shared';

const USAGE = 'diff <before> <after> [--ignore <jsonpath>]... [--limit <n>] [--html <report.html>] [--json]';
const ARRAY_MATCHES = ['align', 'unordered', 'index'];

function countKinds(changes) {
  const counts = { added: 0, removed: 0, changed: 0, moved: 0 };
  changes.forEach((change) => {
    counts[change.kind] += 1;
  });
  return counts;
}

export const diff = {
  name: 'diff',
  summary: 'Structural differences by path, ignoring key order and formatting (exit 1 if any)',
  usage: USAGE,
  description: [
    'Compares values, not text: key order and whitespace are ignored, numbers compare by exact value',
    '(1.5 equals 1.50; two 64-bit ids that differ are different). Arrays are aligned so an inserted',
    'item is one change. Records are matched by their id (id, _id, uuid, guid, sku, or a key such as',
    'productId or order_id), else by key or name; an item found at another position is reported as',
    'moved, or if it also changed, by its changes (with where it was). Two records with different',
    'ids are never paired.',
    'Exit status: 0 when the data is the same, 1 when it differs, 2 on errors.',
  ],
  options: {
    ignore: { type: 'string', multiple: true, description: 'Ignore everything at and under these JSONPaths (repeatable), e.g. timestamps.' },
    limit: { type: 'number', description: 'List at most N differences (default 100; 0 = all).' },
    'array-match': {
      type: 'string',
      description: '"align" (default: find inserted, removed and moved items), "unordered" (the same, but moving an item is not a difference) or "index" (compare position by position).',
    },
    html: { type: 'string', description: 'Also write a visual report (offline HTML page, same --ignore and --array-match) to this file, or with "-" to the private pages folder (see explore).' },
    json: { type: 'boolean', description: 'Print the differences as JSON.' },
    ...SECRET_OPTION,
    ...INPUT_OPTIONS,
  },
  examples: ['diff old.json new.json', "diff a.json b.json --ignore '$..updatedAt' --ignore '$.meta'", 'diff before.json after.json --array-match unordered', 'diff expected.json actual.json --html -'],

  async run({ values, positionals }, ctx) {
    expectPositionals(positionals, 2, 2, USAGE);
    const [leftFile, rightFile] = positionals;
    if (leftFile === '-' && rightFile === '-') throw new UsageError('Only one side of a diff can be read from stdin.');
    const arrays = values['array-match'] ?? 'align';
    if (!ARRAY_MATCHES.includes(arrays)) throw new UsageError('--array-match expects "align", "unordered" or "index".');
    const limit = values.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 0) throw new UsageError('--limit expects a whole number ≥ 0.');
    const ignores = (values.ignore ?? []).map((expression) => compilePath(expression));
    const template = values.html === undefined ? null : readTemplate(ctx);

    const left = await loadDocument(leftFile, values, ctx);
    const right = await loadDocument(rightFile, values, ctx);
    const showSecrets = Boolean(values['show-secrets']);
    const changes = withoutIgnored(diffJson(left.value, right.value, { limit: Infinity, arrays }).changes, [left.value, right.value], ignores, filterOptions(showSecrets));
    const counts = countKinds(changes);
    const counter = { count: 0 };

    if (template !== null) {
      const payload = {
        kind: 'diff',
        left: { name: path.basename(leftFile === '-' ? 'stdin' : leftFile), text: left.json },
        right: { name: path.basename(rightFile === '-' ? 'stdin' : rightFile), text: right.json },
        ignore: values.ignore ?? [],
        arrays,
        generator: `JSON Explorer ${VERSION}`,
      };
      const target = values.html === '-' ? defaultOutput(rightFile, 'diff', ctx) : path.resolve(ctx.cwd, values.html);
      writePage(target, buildViewerPage(template, payload, `${payload.left.name} → ${payload.right.name} · JSON Explorer`), ctx, { inputs: [left.input.path, right.input.path] });
    }

    const shown = limit === 0 ? changes : changes.slice(0, limit);
    // A value is hidden when a sensitive key sits anywhere above it, in either document.
    const hidden = (change) =>
      !showSecrets && ((change.leftPath !== null && isSensitivePath(left.value, change.leftPath)) || (change.rightPath !== null && isSensitivePath(right.value, change.rightPath)));
    const shownPath = (pathArray) => formatPath(showSecrets ? pathArray : redactPathKeys(pathArray, counter));
    if (values.json) {
      const reveal = (value, change) => (showSecrets ? value : redactValue(value, lastKey(change.path), counter, hidden(change)));
      ctx.out(
        stringifyJson(
          {
            total: changes.length,
            counts,
            changes: shown.map((change) => ({
              kind: change.kind,
              path: shownPath(change.path),
              ...(change.leftPath && change.rightPath && formatPath(change.leftPath) !== formatPath(change.rightPath) ? { leftPath: shownPath(change.leftPath) } : {}),
              ...(change.kind !== 'added' ? { before: reveal(change.before, change) } : {}),
              ...(change.kind !== 'removed' ? { after: reveal(change.after, change) } : {}),
              ...(change.typeChanged ? { typeChanged: true } : {}),
            })),
            truncated: shown.length < changes.length,
          },
          2
        )
      );
    } else if (changes.length === 0) {
      ctx.out(`No differences: ${left.input.name} and ${right.input.name} contain the same data${ignores.length ? ' (outside the ignored paths)' : ''}.`);
    } else {
      const lines = [
        `${left.input.name} → ${right.input.name}: ${plural(changes.length, 'difference')} (${counts.added} added, ${counts.removed} removed, ${counts.changed} changed${counts.moved ? `, ${counts.moved} moved` : ''})`,
        '',
      ];
      shown.forEach((change) => {
        const where = shownPath(change.path);
        const was = change.leftPath && change.rightPath && formatPath(change.leftPath) !== formatPath(change.rightPath) ? shownPath(change.leftPath) : null;
        const options = { counter, showSecrets, key: lastKey(change.path), inherited: hidden(change) };
        if (change.kind === 'added') lines.push(`+ ${where}: ${preview(change.after, options)}`);
        else if (change.kind === 'removed') lines.push(`- ${where}: ${preview(change.before, options)}`);
        else if (change.kind === 'moved') lines.push(`↕ ${where}: ${preview(change.after, options)} (${was ? `moved from ${was}` : 'order changed'})`);
        else {
          const shift = was ? ` (was ${was})` : '';
          lines.push(`~ ${where}: ${preview(change.before, { ...options, max: 60 })} → ${preview(change.after, { ...options, max: 60 })}${change.typeChanged ? ' (type changed)' : ''}${shift}`);
        }
      });
      if (shown.length < changes.length) lines.push(`… ${plural(changes.length - shown.length, 'more difference')} (use --limit <n>, --limit 0 for all, or --html for a visual report).`);
      ctx.out(lines.join('\n'));
    }
    const note = secretsNote(counter);
    if (note) ctx.err(note);
    return changes.length > 0 ? 1 : 0;
  },
};
