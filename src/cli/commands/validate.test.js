/** @jest-environment node */
import * as documents from '../documents';
import { FAKE } from '../testing/fakeSecrets';
import { makeWorkspace } from '../testing/workspace';

const size = (text) => `${Buffer.byteLength(text)} B`;
const SCHEMA = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer' }, email: { type: 'string', format: 'email' }, role: { enum: ['admin', 'user'] } },
  additionalProperties: false,
});

let ws;
beforeEach(() => {
  ws = makeWorkspace({ 'schema.json': SCHEMA });
});
afterEach(() => {
  ws.cleanup();
  jest.restoreAllMocks();
});

describe('validate', () => {
  it('confirms valid files', async () => {
    ws.write('ok.json', '{"id": 1}');
    expect(await ws.run(['validate', 'ok.json'])).toEqual({ code: 0, stdout: `✓ ok.json: valid JSON (${size('{"id": 1}')})\n`, stderr: '' });
  });

  it('warns about duplicate keys and imprecise numbers', async () => {
    const text = '{\n  "a": 1,\n  "a": 2,\n  "id": 12345678901234567890\n}';
    ws.write('warn.json', text);
    expect(await ws.run(['validate', 'warn.json'])).toEqual({
      code: 0,
      stdout: [
        `⚠ warn.json: valid JSON (${size(text)}), 2 warnings`,
        '  line 3: Duplicate key "a": most parsers keep only the last value.',
        '  line 4: 1 number cannot be represented exactly as double-precision floats (JavaScript and many JSON libraries would round it).',
        '',
      ].join('\n'),
      stderr: '',
    });
  });

  it('explains syntax errors with an excerpt and a repair tip', async () => {
    ws.write('bad.json', '{\n  "a": 1,\n  "b": 2,\n}');
    const { code, stdout } = await ws.run(['validate', 'bad.json']);
    expect(code).toBe(1);
    expect(stdout).toBe(
      [
        "✗ bad.json: invalid JSON at line 3, column 9: Trailing comma before '}' is not allowed",
        '      1 | {',
        '      2 |   "a": ***,',
        '    > 3 |   "b": ***,',
        '        |           ^',
        '      4 | }',
        '  To fix common mistakes automatically: json-explorer repair <file> --diff',
        '',
      ].join('\n')
    );
  });

  it('hints at JSONC and JSON Lines', async () => {
    ws.write('settings.json', '{\n  // comment\n  "a": 1\n}');
    expect((await ws.run(['validate', 'settings.json'])).stdout).toContain('  Hint: If this file is meant to allow comments (JSONC, like tsconfig.json), validate it with --jsonc.');
    ws.write('lines.json', '{"a": 1}\n{"a": 2}\n');
    expect((await ws.run(['validate', 'lines.json'])).stdout).toContain('  Hint: This looks like JSON Lines (one JSON value per line); validate it with --jsonl.');
    ws.write('trailing.json', '{"a": 1} x');
    expect((await ws.run(['validate', 'trailing.json'])).stdout).not.toContain('Hint');
    ws.write('two.json', '{"a": 1\n}\n{');
    expect((await ws.run(['validate', 'two.json'])).stdout).not.toContain('Hint');
    expect((await ws.run(['validate', 'settings.json', '--jsonc'])).stdout).toMatch(/^✓ settings\.json: valid JSON with comments/);
  });

  it('reports JSONC errors without the JSON repair tip', async () => {
    ws.write('tsconfig.json', '{"a": }');
    const { stdout } = await ws.run(['validate', 'tsconfig.json']);
    expect(stdout).toMatch(/^✗ tsconfig\.json: invalid JSON with comments at line 1, column 7: /);
    expect(stdout).not.toContain('repair');
  });

  it('reports empty files', async () => {
    ws.write('empty.json', '  \n');
    expect(await ws.run(['validate', 'empty.json'])).toEqual({ code: 1, stdout: '✗ empty.json: invalid JSON: The file is empty (a JSON document needs a value).\n', stderr: '' });
  });

  it('hides values in excerpts unless asked', async () => {
    ws.write('secret.json', `{"password": "${FAKE.password}",}`);
    expect((await ws.run(['validate', 'secret.json'])).stdout).toContain('"password": "***"');
    expect((await ws.run(['validate', 'secret.json', '--show-secrets'])).stdout).toContain(`"password": "${FAKE.password}"`);
  });

  it('checks a JSON Schema, pointing at the lines involved', async () => {
    const text = '{\n  "id": "7",\n  "email": "nope",\n  "role": "root",\n  "extra": true\n}';
    ws.write('user.json', text);
    const { code, stdout } = await ws.run(['validate', 'user.json', '--schema', 'schema.json']);
    expect(code).toBe(1);
    expect(stdout).toBe(
      [
        '✗ user.json: valid JSON, but 4 schema errors (schema.json)',
        '  $ (line 1): must NOT have additional properties: "extra"',
        '  $.id (line 2): must be integer',
        '  $.email (line 3): must match format "email"',
        '  $.role (line 4): must be equal to one of the allowed values: "admin", "user"',
        '',
      ].join('\n')
    );
    const limited = await ws.run(['validate', 'user.json', '--schema', 'schema.json', '--max-errors', '1']);
    expect(limited.stdout).toBe('✗ user.json: valid JSON, but 4 schema errors (schema.json)\n  $ (line 1): must NOT have additional properties: "extra"\n  … 3 more schema errors\n');
    ws.write('good.json', '{"id": 3, "role": "admin"}');
    expect((await ws.run(['validate', 'good.json', '--schema', 'schema.json'])).code).toBe(0);
  });

  it('checks every record of a JSON Lines file', async () => {
    ws.write('ok.jsonl', '{"id": 1}\n\n{"id": 2}\n');
    expect(await ws.run(['validate', 'ok.jsonl'])).toEqual({ code: 0, stdout: '✓ ok.jsonl: valid JSON Lines (2 records, 1 blank line)\n', stderr: '' });
    ws.write('dup.jsonl', '{"id": 1, "id": 2}\n');
    expect((await ws.run(['validate', 'dup.jsonl'])).stdout).toBe('⚠ dup.jsonl: valid JSON Lines (1 record), 1 warning\n  line 1: Duplicate key "id": most parsers keep only the last value.\n');
    ws.write('bad.jsonl', '{"id": 1}\n{"id": \n{"token": "abc" "x": 1}\nnope\n');
    const bad = await ws.run(['validate', 'bad.jsonl', '--max-errors', '2']);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toBe(
      [
        '✗ bad.jsonl: 3 invalid lines (JSON Lines; 1 record valid)',
        '  line 2, column 8: Unexpected end of input — the JSON is incomplete',
        '    > 2 | {"id": ',
        '        |        ^',
        "  line 3, column 17: Expected ',' between items",
        '    > 3 | {"token": "***" "x": ***}',
        '        |                 ^',
        '  … 1 more invalid line',
        '',
      ].join('\n')
    );
  });

  it('checks JSON Lines records against a schema', async () => {
    ws.write('users.jsonl', '{"id": 1}\n{"id": "x", "name": 1}\n{"id": 2, "id": 3}\n');
    const { code, stdout } = await ws.run(['validate', 'users.jsonl', '--schema', 'schema.json', '--max-errors', '2']);
    expect(code).toBe(1);
    expect(stdout).toBe(
      [
        '✗ users.jsonl: valid JSON Lines (3 records), but 2 schema errors (schema.json)',
        '  line 2: $: must NOT have additional properties: "name"',
        '  line 2: $.id: must be integer',
        '  line 3: Duplicate key "id": most parsers keep only the last value.',
        '',
      ].join('\n')
    );
    const limited = await ws.run(['validate', 'users.jsonl', '--schema', 'schema.json', '--max-errors', '1']);
    expect(limited.stdout).toContain('  … 1 more schema error\n');
  });

  it('lists every invalid line when there are few, and limits warnings', async () => {
    ws.write('two.jsonl', '{"a": }\n{"a": 1, "a": 2}\n{"b": 1, "b": 2}\n');
    const { stdout } = await ws.run(['validate', 'two.jsonl', '--max-errors', '1']);
    expect(stdout).toBe('✗ two.jsonl: 1 invalid line (JSON Lines; 2 records valid)\n  line 1, column 7: Expected a value\n    > 1 | {"a": }\n        |       ^\n  line 2: Duplicate key "a": most parsers keep only the last value.\n');
  });

  it('checks deeply nested documents against a schema, without line numbers', async () => {
    ws.write('deep.json', `${'['.repeat(20000)}${']'.repeat(20000)}`);
    ws.write('object.schema.json', '{"type": "object"}');
    expect((await ws.run(['validate', 'deep.json', '--schema', 'object.schema.json'])).stdout).toBe('✗ deep.json: valid JSON, but 1 schema error (object.schema.json)\n  $: must be object\n');
  });

  it('checks multipleOf with decimal divisors as people mean it', async () => {
    ws.write('prices.json', '[0.07, 4.35, 19.99, 1.10]');
    ws.write('cents.schema.json', '{"type": "array", "items": {"multipleOf": 0.01}}');
    expect((await ws.run(['validate', 'prices.json', '--schema', 'cents.schema.json'])).code).toBe(0);
    ws.write('odd.json', '[0.075]');
    expect((await ws.run(['validate', 'odd.json', '--schema', 'cents.schema.json'])).code).toBe(1);
  });

  it('validates several files and summarizes', async () => {
    ws.write('a.json', '[]');
    ws.write('b.json', '[');
    const { code, stdout } = await ws.run(['validate', 'a.json', 'b.json', 'missing.json', 'events.jsonl']);
    // Files that cannot be read are errors: exit status 2.
    expect(code).toBe(2);
    expect((await ws.run(['validate', 'a.json', 'b.json'])).code).toBe(1);
    expect(stdout.split('\n')).toEqual([
      `✓ a.json: valid JSON (2 B)`,
      expect.stringMatching(/^✗ b\.json: invalid JSON at line 1, column 2: /),
      expect.any(String),
      expect.any(String),
      '  To fix common mistakes automatically: json-explorer repair <file> --diff',
      '✗ missing.json: no such file.',
      '✗ events.jsonl: no such file.',
      '',
      '4 files: 1 valid, 3 invalid.',
      '',
    ]);
  });

  it('names the file when an error message does not', async () => {
    ws.write('big.json', '[1]');
    expect((await ws.run(['validate', 'big.json', '--max-size', '0.000001'])).stdout).toBe('✗ big.json is 3 B, over the 0.000001 MB limit for loading a whole document. Loading takes about ten times its size in memory: raise the limit with --max-size <MB> if this machine has it (past about 2 GB, also give Node.js more with NODE_OPTIONS=--max-old-space-size=<MB>). JSON Lines files are streamed by outline, validate and query at any size.\n');
    expect((await ws.run(['validate', 'big.json', '--max-size', '0'])).stderr).toContain('--max-size expects a number of MB greater than 0.');
    expect((await ws.run(['validate', '-'], { stdin: '[1,' })).stdout).toMatch(/^✗ stdin: invalid JSON/);
    ws.write('folder/x.json', '1');
    expect((await ws.run(['validate', 'folder/x.json/inner'])).stdout).toMatch(/^✗ folder\/x\.json\/inner: Cannot read folder\/x\.json\/inner: /);
  });

  it('prints JSON', async () => {
    ws.write('user.json', '{"id": "7"}');
    const { stdout } = await ws.run(['validate', 'user.json', '--schema', 'schema.json', '--json']);
    expect(JSON.parse(stdout)).toEqual([
      {
        file: 'user.json',
        dialect: 'json',
        valid: false,
        bytes: 11,
        warnings: [],
        schemaErrors: [{ path: ['id'], jsonPath: '$.id', message: 'must be integer', location: ' (line 1)' }],
        schemaErrorCount: 1,
      },
    ]);
  });

  it('rejects unusable schemas and options', async () => {
    ws.write('x.json', '{}');
    ws.write('old.json', '{"$schema": "http://json-schema.org/draft-04/schema#"}');
    expect((await ws.run(['validate', 'x.json', '--schema', 'old.json'])).stderr).toContain('uses JSON Schema draft-04, which is not supported.');
    ws.write('broken.json', '{');
    expect((await ws.run(['validate', 'x.json', '--schema', 'broken.json'])).stderr).toMatch(/^json-explorer: broken\.json is not valid JSON/);
    expect((await ws.run(['validate', 'x.json', '--max-errors', '0'])).stderr).toContain('--max-errors expects a whole number ≥ 1.');
    expect((await ws.run(['validate'])).stderr).toContain('Usage: json-explorer validate <file>...');
  });

  it('does not hide unexpected failures', async () => {
    ws.write('x.json', '{}');
    jest.spyOn(documents, 'parseText').mockImplementation(() => {
      throw new TypeError('kaboom');
    });
    const { code, stderr } = await ws.run(['validate', 'x.json']);
    expect(code).toBe(2);
    expect(stderr).toContain('unexpected error: TypeError: kaboom');
  });
});
