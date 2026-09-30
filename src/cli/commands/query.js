import path from 'node:path';
import { formatPath, sliceText, stringifyJson } from '../../utils/json';
import { UsageError } from '../args';
import { parseLine } from '../documents';
import { readLines, writeFileAtomic } from '../io';
import { compilePath, compileRecordQuery } from '../jsonpath';
import { isSensitivePath, redactPathKeys, redactValue } from '../redact';
import { derivedMode, dialectFor, displayPath, filterOptions, forTerminal, INPUT_OPTIONS, lastKey, loadDocument, plural, precisionNote, secretsNote, SECRET_OPTION, skippedNote } from './shared';

const USAGE = 'query <file> <path>... [--limit <n>] [--count] [--paths] [--values] [--raw] [--json] [--exit-status] [-o <file>]';

function indentContinuation(text) {
  return text.replace(/\n/g, '\n  ');
}

/** Streams a JSON Lines file through record-wise queries, keeping `limit` matches and counting all. */
async function queryRecords(file, queries, limit, ctx, filters) {
  const results = queries.map(({ expression }) => ({ expression, nodes: [], total: 0 }));
  let index = 0;
  const invalid = [];
  const done = () => queries.every(({ record }) => index > record.last);
  for await (const { line, number } of readLines(file, ctx)) {
    const parsed = parseLine(line, number);
    if (parsed.blank) continue;
    if (!parsed.ok) {
      invalid.push(parsed.error);
      continue;
    }
    precisionNote(parsed, ctx);
    for (let position = 0; position < queries.length; position += 1) {
      const { record } = queries[position];
      if (index > record.last) continue;
      const found = record.match(parsed.value, index, filters);
      const result = results[position];
      result.total += found.length;
      const room = limit === 0 ? found.length : Math.max(0, limit - result.nodes.length);
      for (let kept = 0; kept < Math.min(room, found.length); kept += 1) {
        const node = found[kept];
        // Whether a sensitive key sits above the match, judged within its record ($[index] comes first).
        result.nodes.push({ value: node.value, path: node.path, hidden: isSensitivePath(parsed.value, node.path.slice(1)) });
      }
    }
    index += 1;
    if (done()) break;
  }
  return { results, invalid };
}

export const query = {
  name: 'query',
  summary: 'Extract values with JSONPath (RFC 9535) or JSON Pointer, exactly as written',
  usage: USAGE,
  description: [
    'Prints each match as "path: value". Paths are JSONPath (RFC 9535): $.a.b, $.items[0], $.items[-1],',
    "$.items[0:5], $.items[*].name, $..email, $.items[?@.price > 10], $[?@.level == 'error'],",
    "$[?match(@.id, 'a.*')], length(), count(), value(), search(); or JSON Pointers like /items/0/name.",
    'Numbers keep every digit. Secret-looking values are masked, and filters read them as absent, unless --show-secrets.',
    'For JSON Lines, $ is the list of records; queries that pick records one by one ($[*]…, $[?…]…)',
    'are streamed, so they work on files of any size.',
  ],
  options: {
    limit: { type: 'number', description: 'Show at most N matches per path (default 50; 0 = all).' },
    count: { type: 'boolean', description: 'Print only the number of matches.' },
    paths: { type: 'boolean', description: 'Print only the paths of the matches.' },
    values: { type: 'boolean', description: 'Print only the values (add --compact for one line per match).' },
    raw: { type: 'boolean', description: 'Print strings without quotes (implies --values).' },
    compact: { type: 'boolean', description: 'Print each value on one line.' },
    'max-chars': { type: 'number', description: 'Truncate each printed value after N characters (default 4000; 0 = never).' },
    json: { type: 'boolean', description: 'Print the matches as JSON: [{ "query", "total", "matches": [{ "path", "value" }] }] (with --count only the totals, with --paths no values).' },
    out: { type: 'string', alias: 'o', description: 'Write the matched value (or an array of matches) to a file instead.' },
    'exit-status': { type: 'boolean', description: 'Exit with 1 when a query matches nothing, as grep does (by default the exit status is 0 either way).' },
    ...SECRET_OPTION,
    ...INPUT_OPTIONS,
  },
  examples: ["query data.json '$.users[0]'", "query data.json '$..email' --count", "query events.jsonl '$[?@.level == \"error\"].message' --values", 'query config.json /server/port'],

  async run({ values, positionals }, ctx) {
    if (positionals.length < 2) throw new UsageError(`Usage: json-explorer ${USAGE}`);
    const [file, ...expressions] = positionals;
    const limit = values.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 0) throw new UsageError('--limit expects a whole number ≥ 0.');
    const maxChars = values['max-chars'] ?? 4000;
    if (!Number.isInteger(maxChars) || maxChars < 0) throw new UsageError('--max-chars expects a whole number ≥ 0.');
    if (values.out && expressions.length > 1) throw new UsageError('-o writes one query result; give a single path.');
    const compiled = expressions.map((expression) => ({ expression, path: compilePath(expression) }));
    const dialect = dialectFor(file, values);
    const showSecrets = Boolean(values['show-secrets']);
    const filters = filterOptions(showSecrets);
    const counter = { count: 0 };
    let results;
    let invalid = [];
    let document = null;

    const recordQueries = dialect === 'jsonl' ? expressions.map((expression) => (expression.startsWith('$') ? compileRecordQuery(expression) : null)) : [];
    if (dialect === 'jsonl' && recordQueries.every(Boolean) && !values.out) {
      ({ results, invalid } = await queryRecords(
        file,
        compiled.map(({ expression }, index) => ({ expression, record: recordQueries[index] })),
        limit,
        ctx,
        filters
      ));
    } else {
      document = await loadDocument(file, values, ctx, { skipInvalidLines: true });
      results = compiled.map(({ expression, path: selector }) => {
        const nodes = selector.evaluate(document.value, filters);
        return { expression, total: nodes.length, nodes: limit === 0 || values.out ? nodes : nodes.slice(0, limit), singular: selector.singular };
      });
    }

    const shownValue = (node) => (showSecrets ? node.value : redactValue(node.value, lastKey(node.path), counter, node.hidden ?? isSensitivePath(document.value, node.path)));
    const shownPath = (node) => formatPath(showSecrets ? node.path : redactPathKeys(node.path, counter));

    if (values.out) {
      const [{ nodes, singular, expression }] = results;
      if (nodes.length === 0) throw new UsageError(`Nothing matches ${expression}; no file written.`);
      const content = singular && nodes.length === 1 ? nodes[0].value : nodes.map((node) => node.value);
      const target = path.resolve(ctx.cwd, values.out);
      writeFileAtomic(target, `${stringifyJson(content, 2)}\n`, { mode: derivedMode(document.input), inputs: [document.input.path] });
      ctx.out(`Wrote ${plural(nodes.length, 'match', 'matches')} for ${expression} to ${displayPath(target, ctx.cwd)}.`);
      return 0;
    }

    if (values.json) {
      const payload = results.map(({ expression, total, nodes }) => ({
        query: expression,
        total,
        ...(values.count ? {} : { matches: nodes.map((node) => (values.paths ? { path: shownPath(node) } : { path: shownPath(node), value: shownValue(node) })) }),
      }));
      ctx.out(stringifyJson(payload, 2));
    } else {
      const lines = [];
      results.forEach(({ expression, total, nodes }) => {
        if (results.length > 1) lines.push(`${lines.length > 0 ? '\n' : ''}${expression}:`);
        if (values.count) {
          lines.push(String(total));
          return;
        }
        if (total === 0) {
          lines.push(`No matches for ${expression}.`);
          return;
        }
        nodes.forEach((node) => {
          const pathText = shownPath(node);
          if (values.paths) {
            lines.push(pathText);
            return;
          }
          const value = shownValue(node);
          let text = values.raw && typeof value === 'string' ? forTerminal(value, ctx) : stringifyJson(value, values.compact ? undefined : 2);
          if (maxChars > 0 && text.length > maxChars) text = `${sliceText(text, maxChars)}… (truncated at ${maxChars.toLocaleString('en-US')} characters; use --max-chars 0 or -o <file> for everything)`;
          lines.push(values.values || values.raw ? text : `${pathText}: ${indentContinuation(text)}`);
        });
        if (total > nodes.length) lines.push(`… ${plural(total - nodes.length, 'more match', 'more matches')} (use --limit <n>, or --limit 0 for all).`);
      });
      ctx.out(lines.join('\n'));
    }
    if (invalid.length > 0) ctx.err(skippedNote(invalid));
    const note = secretsNote(counter);
    if (note) ctx.err(note);
    return values['exit-status'] && results.some(({ total }) => total === 0) ? 1 : 0;
  },
};
