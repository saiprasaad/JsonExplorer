import path from 'node:path';
import { safeTypeName, singularize, toCsv, toJsonSchema, toTypeScript, toYaml } from '../../utils/convert';
import { formatBytes, stringifyJson } from '../../utils/json';
import { UsageError } from '../args';
import { InputError, writeFileAtomic } from '../io';
import { compilePath } from '../jsonpath';
import { derivedMode, displayPath, expectPositionals, forTerminal, INPUT_OPTIONS, loadDocument } from './shared';

const USAGE = 'convert <file> --to <ts|schema|yaml|csv|tsv|jsonl|json> [--path <jsonpath>] [--name <Name>] [-o <out>]';
const TS_NAME = /^[A-Za-z_$][\w$]*$/;

const FORMATS = {
  ts: 'ts',
  typescript: 'ts',
  schema: 'schema',
  'json-schema': 'schema',
  yaml: 'yaml',
  yml: 'yaml',
  csv: 'csv',
  tsv: 'tsv',
  jsonl: 'jsonl',
  ndjson: 'jsonl',
  json: 'json',
};

// Words a TypeScript interface cannot be named (reserved words and built-in type names).
const RESERVED_TYPE_NAMES = new Set(
  (
    'any as async await bigint boolean break case catch class const constructor continue debugger declare default delete do else ' +
    'enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let ' +
    'module namespace never new null number object of package private protected public readonly require return set static ' +
    'string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield'
  ).split(' ')
);

/**
 * The root type name: the selected member's name or the file's, in PascalCase and singular for a
 * list of records (events.jsonl → Event, made EventRecord so it does not shadow the DOM's Event).
 */
function typeName(file, records, selected, expression) {
  const key = selected?.[selected.length - 1];
  // For several matches, the last name in the path names them ($.data.items[*] → Item).
  const named = records && expression ? expression.replace(/\[\?[^\]]*\]/g, '').match(/[A-Za-z_]\w*/g)?.pop() : undefined;
  const source = typeof key === 'string' ? key : (named ?? (file === '-' ? '' : path.basename(file).replace(/\.[^.]+$/, '')));
  const words = source.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
  if (!/^[A-Za-z]/.test(name)) return records ? 'Item' : 'Root';
  return records ? safeTypeName(singularize(name), 'Record') : safeTypeName(name);
}

export const convert = {
  name: 'convert',
  summary: 'Convert to TypeScript types, JSON Schema, YAML, CSV/TSV, JSON Lines or JSON',
  usage: USAGE,
  description: [
    'ts / schema infer types from every record (fields missing from some records become optional).',
    'yaml writes YAML that parses back to the same data (YAML 1.1 and 1.2). csv / tsv flatten nested',
    'objects into columns (owner.name) and neutralise spreadsheet formulas. jsonl writes one record per',
    'line; json writes pretty JSON (e.g. from JSON Lines or JSONC). Numbers keep every digit.',
    'For JSON Lines input, ts and schema describe one record.',
  ],
  options: {
    to: { type: 'string', description: 'Output format: ts, schema, yaml, csv, tsv, jsonl or json.' },
    path: { type: 'string', description: 'Convert only what this JSONPath selects (several matches become a list).' },
    name: { type: 'string', description: 'Root type name (ts) or title (schema).' },
    delimiter: { type: 'string', description: 'CSV field delimiter (default ",").' },
    out: { type: 'string', alias: 'o', description: 'Write the result to this file.' },
    ...INPUT_OPTIONS,
  },
  examples: ['convert response.json --to ts --name ApiResponse', 'convert users.json --to csv -o users.csv', "convert api.json --path '$.data.items[*]' --to schema", 'convert events.jsonl --to csv'],

  async run({ values, positionals }, ctx) {
    expectPositionals(positionals, 1, 1, USAGE);
    const [file] = positionals;
    const to = FORMATS[String(values.to ?? '').toLowerCase()];
    if (!to) throw new UsageError(`--to expects one of: ${Object.keys(FORMATS).join(', ')}.`);
    if (values.delimiter !== undefined && (to !== 'csv' || values.delimiter.length !== 1)) throw new UsageError('--delimiter takes one character and applies to --to csv.');
    if (values.name !== undefined) {
      if (to !== 'ts' && to !== 'schema') throw new UsageError('--name applies to --to ts and --to schema.');
      if (to === 'ts' && (!TS_NAME.test(values.name) || RESERVED_TYPE_NAMES.has(values.name))) throw new UsageError(`--name must be a TypeScript type name, like ApiResponse ("${values.name}" is not).`);
    }
    // A broken line in a log should not stop the conversion of the rest: it is left out, with a note.
    const document = await loadDocument(file, values, ctx, { skipInvalidLines: true });
    let value = document.value;
    let records = document.dialect === 'jsonl';
    let selected = null;
    if (values.path !== undefined) {
      const selector = compilePath(values.path);
      const nodes = selector.evaluate(value);
      if (nodes.length === 0) throw new InputError(`Nothing matches ${values.path} in ${document.input.name}.`);
      records = !(selector.singular && nodes.length === 1);
      value = records ? nodes.map((node) => node.value) : nodes[0].value;
      selected = records ? null : nodes[0].path;
    }

    let output;
    try {
      if (to === 'ts') output = toTypeScript(value, values.name ?? typeName(file, records, selected, values.path), { records });
      else if (to === 'schema') output = toJsonSchema(value, values.name, { records });
      else if (to === 'yaml') output = toYaml(value);
      else if (to === 'csv' || to === 'tsv') output = toCsv(value, { delimiter: to === 'tsv' ? '\t' : values.delimiter ?? ',' });
      else if (to === 'jsonl') {
        if (!Array.isArray(value)) throw new Error('JSON Lines needs a list of records: select an array (e.g. --path "$.items").');
        output = value.map((item) => `${stringifyJson(item)}\n`).join('');
      } else output = `${stringifyJson(value, 2)}\n`;
    } catch (error) {
      throw new InputError(error instanceof RangeError ? `${document.input.name} is nested too deeply to convert.` : error.message);
    }

    if (values.out) {
      const written = writeFileAtomic(path.resolve(ctx.cwd, values.out), output, { mode: derivedMode(document.input), inputs: [document.input.path] });
      ctx.out(`Wrote ${displayPath(written, ctx.cwd)} (${formatBytes(Buffer.byteLength(output))}).`);
    } else {
      ctx.write(to === 'csv' || to === 'tsv' ? forTerminal(output, ctx) : output);
    }
    return 0;
  },
};
