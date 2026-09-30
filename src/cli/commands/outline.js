import fs from 'node:fs';
import path from 'node:path';
import { formatBytes, formatPath } from '../../utils/json';
import { UsageError } from '../args';
import { parseLine } from '../documents';
import { readLines } from '../io';
import { compilePath, compileRecordQuery } from '../jsonpath';
import { OutlineBuilder, renderOutline } from '../outline';
import { dialectFor, describeInput, expectPositionals, filterOptions, INPUT_OPTIONS, loadDocument, plural, precisionNote, skippedNote } from './shared';

const USAGE = 'outline <file> [--path <jsonpath>] [--depth <n>] [--samples <n>] [--json]';

function nonNegativeInteger(values, name) {
  const value = values[name];
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new UsageError(`--${name} expects a whole number ≥ 0.`);
  return value;
}

export const outline = {
  name: 'outline',
  summary: 'Summarize structure: fields, types, presence, formats, ranges (no raw values by default)',
  usage: USAGE,
  description: [
    'Maps a document without printing its data: every path (array items folded into [*]), its',
    'types, how often it is present, string formats and lengths, number ranges and distinct counts.',
    'JSON Lines files are streamed, so any size works. Fields whose names suggest secrets never',
    'show samples.',
  ],
  options: {
    path: { type: 'string', description: 'Outline only what this JSONPath (or JSON Pointer) selects. For JSON Lines, $ is the list of records, as in query.' },
    depth: { type: 'number', description: 'Show paths up to this nesting depth.' },
    samples: { type: 'number', description: 'Include up to N example values per path (default 0: none).' },
    'max-paths': { type: 'number', description: 'Show at most this many paths (default 200).' },
    records: { type: 'number', description: 'JSON Lines: analyze only the first N records.' },
    json: { type: 'boolean', description: 'Print the outline as JSON.' },
    ...INPUT_OPTIONS,
  },
  examples: ['outline data.json', 'outline events.jsonl --samples 3', "outline api.json --path '$.data.items[*]' --depth 3"],

  async run({ values, positionals }, ctx) {
    expectPositionals(positionals, 1, 1, USAGE);
    const [file] = positionals;
    const samples = nonNegativeInteger(values, 'samples') ?? 0;
    const depth = nonNegativeInteger(values, 'depth');
    const maxPaths = nonNegativeInteger(values, 'max-paths') ?? 200;
    const recordLimit = nonNegativeInteger(values, 'records');
    const dialect = dialectFor(file, values);
    if (recordLimit !== undefined && dialect !== 'jsonl') throw new UsageError('--records applies to JSON Lines files only.');
    const selector = values.path === undefined ? null : compilePath(values.path);
    // For JSON Lines, a path that picks records one by one ($[*].user) is streamed; others need every record.
    const recordQuery = dialect === 'jsonl' && selector && values.path.startsWith('$') ? compileRecordQuery(values.path) : null;
    // An outline never shows secrets, so its filters never read them either.
    const filters = filterOptions(false);
    const builder = new OutlineBuilder({ samples });
    const facts = [];
    const stats = {};
    let heading;
    let matches = 0;

    if (dialect === 'jsonl' && (!selector || recordQuery)) {
      if (!selector) builder.startList('$');
      let records = 0;
      let invalid = 0;
      let firstInvalid = null;
      let truncated = false;
      for await (const { line, number } of readLines(file, ctx)) {
        const parsed = parseLine(line, number);
        if (parsed.blank) continue;
        if (!parsed.ok) {
          invalid += 1;
          firstInvalid ??= parsed.error;
          continue;
        }
        if (recordLimit !== undefined && records >= recordLimit) {
          truncated = true;
          break;
        }
        precisionNote(parsed, ctx);
        if (recordQuery) {
          const found = recordQuery.match(parsed.value, records, filters);
          for (const node of found) builder.add(node.value, values.path);
          matches += found.length;
        } else {
          // Records sit one level down, under the list of records ($).
          builder.add(parsed.value, '$[*]', '$', 1);
        }
        records += 1;
      }
      if (!selector) builder.endList('$', records);
      const bytes = file === '-' ? null : fs.statSync(path.resolve(ctx.cwd, file)).size;
      heading = `${file === '-' ? 'stdin' : file} · JSON Lines${bytes === null ? '' : ` · ${formatBytes(bytes)}`} · ${plural(records, 'record')}`;
      if (truncated) facts.push(`only the first ${plural(records, 'record')} analyzed (--records)`);
      if (invalid > 0) facts.push(skippedNote([firstInvalid], invalid).replace(/^Note: /, '').replace(/\.$/, ''));
      if (selector && matches > 0) facts.push(`outline of ${plural(matches, 'match', 'matches')} for ${values.path}`);
      Object.assign(stats, { records, invalidLines: invalid, truncated });
    } else {
      const document = await loadDocument(file, values, ctx, { skipInvalidLines: true });
      heading = describeInput(document.input, dialect);
      if (document.records !== undefined) heading += ` · ${plural(document.records, 'record')}`;
      if (recordLimit !== undefined && document.value.length > recordLimit) {
        document.value = document.value.slice(0, recordLimit);
        facts.push(`only the first ${plural(recordLimit, 'record')} analyzed (--records)`);
      }
      if (selector) {
        const nodes = selector.evaluate(document.value, filters);
        matches = nodes.length;
        const label = nodes.length === 1 ? formatPath(nodes[0].path) : values.path;
        nodes.forEach((node) => builder.add(node.value, label));
        if (nodes.length > 0) facts.push(nodes.length === 1 ? `outline of ${label}` : `outline of ${plural(nodes.length, 'match', 'matches')} for ${values.path}`);
      } else {
        builder.add(document.value);
      }
    }
    if (selector && matches === 0) {
      ctx.out([heading, ...facts.map((fact) => `Note: ${fact}.`), `Nothing matches ${values.path}.`].join('\n'));
      return 1;
    }

    const result = builder.result();
    if (values.json) {
      ctx.out(JSON.stringify({ heading, notes: facts, ...stats, values: result.values, maxDepth: result.maxDepth, totals: result.totals, paths: result.paths }, null, 2));
      return 0;
    }
    const summary = `${heading} · ${plural(result.values, 'value')} · depth ${result.maxDepth}`;
    const lines = [summary, ...facts.map((fact) => `Note: ${fact}.`)];
    lines.push(samples > 0 ? `Examples shown for up to ${plural(samples, 'value')} per path (none for sensitive fields).` : 'Values are summarized, not shown (add --samples 3 for examples).');
    lines.push('', renderOutline(result, { maxPaths, depth }));
    ctx.out(lines.join('\n'));
    return 0;
  },
};
