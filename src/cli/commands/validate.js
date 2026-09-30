import { findPathRange, formatBytes } from '../../utils/json';
import { codeFrame, DIALECT_LABELS, findWarnings, parseLine, parseText } from '../documents';
import { InputError, readLines } from '../io';
import { compileSchema, describeSchemaErrors } from '../schema';
import { dialectFor, INPUT_OPTIONS, loadDocument, plural, readFile, SECRET_OPTION } from './shared';
import { UsageError } from '../args';

const USAGE = 'validate <file>... [--schema <schema.json>] [--max-errors <n>] [--json]';

function hintFor(error, text, dialect) {
  if (dialect !== 'json') return null;
  if (/^Comments are not allowed/.test(error.message)) return 'If this file is meant to allow comments (JSONC, like tsconfig.json), validate it with --jsonc.';
  if (/^Unexpected content after the end/.test(error.message) && error.line > 1) {
    const firstLine = text.split(/\r?\n/, 1)[0];
    if (parseText(firstLine, 'json').ok) return 'This looks like JSON Lines (one JSON value per line); validate it with --jsonl.';
  }
  return null;
}

function schemaLocation(text, pathArray) {
  const range = findPathRange(text, pathArray);
  if (!range) return '';
  const before = text.slice(0, range.keyOffset ?? range.offset);
  return ` (line ${before.split('\n').length})`;
}

async function validateLines(file, values, ctx, schema, maxErrors) {
  const report = { file, dialect: 'jsonl', valid: true, records: 0, blankLines: 0, errors: [], errorCount: 0, schemaErrors: [], schemaErrorCount: 0, warnings: [] };
  for await (const { line, number } of readLines(file, ctx)) {
    const parsed = parseLine(line, number);
    if (parsed.blank) {
      report.blankLines += 1;
      continue;
    }
    if (!parsed.ok) {
      report.errorCount += 1;
      if (report.errors.length < maxErrors) {
        const { message, column } = parsed.error;
        report.errors.push({ line: number, column, message, frame: codeFrame(line, 1, column, { context: 0, showSecrets: values['show-secrets'], lineOffset: number - 1 }) });
      }
      continue;
    }
    report.records += 1;
    if (report.warnings.length < maxErrors) report.warnings.push(...findWarnings(line, { lineOffset: number - 1 }).slice(0, maxErrors - report.warnings.length));
    if (schema && !schema.validate(JSON.parse(line))) {
      report.schemaErrorCount += schema.validate.errors.length;
      describeSchemaErrors(schema.validate.errors).forEach((error) => {
        if (report.schemaErrors.length < maxErrors) report.schemaErrors.push({ ...error, line: number });
      });
    }
  }
  report.valid = report.errorCount === 0 && report.schemaErrorCount === 0;
  return report;
}

async function validateDocument(file, values, ctx, schema, dialect, maxErrors) {
  const input = await readFile(file, values, ctx);
  const report = { file, dialect, valid: true, bytes: input.bytes, warnings: [], schemaErrors: [], schemaErrorCount: 0 };
  const parsed = parseText(input.text, dialect);
  if (!parsed.ok) {
    report.valid = false;
    if (parsed.empty) {
      report.error = { message: 'The file is empty (a JSON document needs a value).' };
      return report;
    }
    const { message, line, column } = parsed.error;
    report.error = { message, line, column, frame: codeFrame(input.text, line, column, { showSecrets: values['show-secrets'] }) };
    const hint = hintFor(parsed.error, input.text, dialect);
    if (hint) report.hint = hint;
    return report;
  }
  report.warnings = findWarnings(input.text, { jsonc: dialect === 'jsonc', limit: maxErrors });
  if (schema && !schema.validate(JSON.parse(parsed.json))) {
    report.valid = false;
    const errors = describeSchemaErrors(schema.validate.errors);
    report.schemaErrorCount = errors.length;
    report.schemaErrors = errors.slice(0, maxErrors).map((error) => ({ ...error, location: schemaLocation(input.text, error.path) }));
  }
  return report;
}

function render(report, schemaName) {
  const label = DIALECT_LABELS[report.dialect];
  const lines = [];
  const indent = (text) => text.replace(/^/gm, '    ');
  if (report.fatal) {
    // Most input errors already start with the file name.
    lines.push(report.fatal.startsWith(report.file) ? `✗ ${report.fatal}` : `✗ ${report.file}: ${report.fatal}`);
    return lines;
  }
  if (report.dialect === 'jsonl') {
    const summary = `${plural(report.records, 'record')}${report.blankLines ? `, ${plural(report.blankLines, 'blank line')}` : ''}`;
    if (report.errorCount > 0) {
      lines.push(`✗ ${report.file}: ${plural(report.errorCount, 'invalid line')} (${label}; ${summary} valid)`);
      report.errors.forEach((error) => lines.push(`  line ${error.line}, column ${error.column}: ${error.message}`, indent(error.frame)));
      if (report.errorCount > report.errors.length) lines.push(`  … ${plural(report.errorCount - report.errors.length, 'more invalid line')}`);
    } else if (report.schemaErrorCount > 0) {
      lines.push(`✗ ${report.file}: valid ${label} (${summary}), but ${plural(report.schemaErrorCount, 'schema error')} (${schemaName})`);
    } else {
      lines.push(`${report.warnings.length ? '⚠' : '✓'} ${report.file}: valid ${label} (${summary})${report.warnings.length ? `, ${plural(report.warnings.length, 'warning')}` : ''}`);
    }
  } else if (report.error) {
    const where = report.error.line ? ` at line ${report.error.line}, column ${report.error.column}` : '';
    lines.push(`✗ ${report.file}: invalid ${label}${where}: ${report.error.message}`);
    if (report.error.frame) lines.push(indent(report.error.frame));
    if (report.hint) lines.push(`  Hint: ${report.hint}`);
    if (report.dialect === 'json' && report.error.frame) lines.push('  To fix common mistakes automatically: json-explorer repair <file> --diff');
  } else if (report.schemaErrorCount > 0) {
    lines.push(`✗ ${report.file}: valid ${label}, but ${plural(report.schemaErrorCount, 'schema error')} (${schemaName})`);
  } else {
    const size = formatBytes(report.bytes);
    lines.push(`${report.warnings.length ? '⚠' : '✓'} ${report.file}: valid ${label} (${size})${report.warnings.length ? `, ${plural(report.warnings.length, 'warning')}` : ''}`);
  }
  report.schemaErrors.forEach((error) => lines.push(error.line ? `  line ${error.line}: ${error.jsonPath}: ${error.message}` : `  ${error.jsonPath}${error.location}: ${error.message}`));
  if (report.schemaErrorCount > report.schemaErrors.length) lines.push(`  … ${plural(report.schemaErrorCount - report.schemaErrors.length, 'more schema error')}`);
  report.warnings.forEach((warning) => lines.push(`  line ${warning.line}: ${warning.message}`));
  return lines;
}

export const validate = {
  name: 'validate',
  summary: 'Check syntax (friendly errors with line/column) and optionally a JSON Schema',
  usage: USAGE,
  description: [
    'Reports the first syntax error of each file with a code excerpt and a plain explanation, and',
    'warns about duplicate keys and numbers that lose precision in JavaScript. With --schema, also',
    'validates the data against a JSON Schema (draft-06, draft-07, 2019-09 or 2020-12).',
    'JSON Lines files are checked line by line and streamed, so any size works.',
    'Exit status: 0 when everything is valid, 1 when something is not, 2 on errors (such as a file',
    'that cannot be read).',
  ],
  options: {
    schema: { type: 'string', description: 'Also validate against this JSON Schema file.' },
    'max-errors': { type: 'number', description: 'Report at most N errors or warnings per file (default 20).' },
    json: { type: 'boolean', description: 'Print the results as JSON.' },
    ...SECRET_OPTION,
    ...INPUT_OPTIONS,
  },
  examples: ['validate config.json', 'validate data/*.json', 'validate events.jsonl', 'validate response.json --schema response.schema.json'],

  async run({ values, positionals }, ctx) {
    if (positionals.length === 0) throw new UsageError(`Usage: json-explorer ${USAGE}`);
    const maxErrors = values['max-errors'] ?? 20;
    if (!Number.isInteger(maxErrors) || maxErrors < 1) throw new UsageError('--max-errors expects a whole number ≥ 1.');
    let schema = null;
    if (values.schema !== undefined) {
      const schemaDocument = await loadDocument(values.schema, { ...values, jsonl: false, jsonc: false, strict: false }, ctx);
      schema = { validate: compileSchema(JSON.parse(schemaDocument.json), values.schema) };
    }
    const reports = [];
    for (const file of positionals) {
      const dialect = dialectFor(file, values);
      try {
        reports.push(dialect === 'jsonl' ? await validateLines(file, values, ctx, schema, maxErrors) : await validateDocument(file, values, ctx, schema, dialect, maxErrors));
      } catch (error) {
        if (!(error instanceof InputError)) throw error;
        reports.push({ file, dialect, valid: false, fatal: error.message, warnings: [], schemaErrors: [] });
      }
    }
    reports.forEach((report) => {
      if (report.file === '-') report.file = 'stdin';
    });
    const invalid = reports.filter((report) => !report.valid).length;
    if (values.json) {
      ctx.out(JSON.stringify(reports, null, 2));
    } else {
      const lines = reports.flatMap((report) => render(report, values.schema));
      if (reports.length > 1) lines.push('', `${plural(reports.length, 'file')}: ${reports.length - invalid} valid, ${invalid} invalid.`);
      ctx.out(lines.join('\n'));
    }
    // A file that could not be read is an error (2), not an invalid file (1).
    if (reports.some((report) => report.fatal)) return 2;
    return invalid > 0 ? 1 : 0;
  },
};
