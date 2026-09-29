/** @jest-environment node */
import { RawNumber } from '../utils/json';
import { codeFrame, detectDialect, DIALECT_LABELS, DocumentError, findWarnings, jsoncToJson, parseDocument, parseLine, parseText } from './documents';
import { FAKE } from './testing/fakeSecrets';

describe('detectDialect', () => {
  it.each([
    ['events.jsonl', 'jsonl'],
    ['logs/app.NDJSON', 'jsonl'],
    ['x.jsonlines', 'jsonl'],
    ['settings.jsonc', 'jsonc'],
    ['tsconfig.json', 'jsonc'],
    ['packages/app/tsconfig.base.json', 'jsonc'],
    ['jsconfig.json', 'jsonc'],
    ['.vscode/settings.json', 'jsonc'],
    ['C:\\repo\\.vscode\\launch.json', 'jsonc'],
    ['.devcontainer/devcontainer.json', 'jsonc'],
    ['.devcontainer.json', 'jsonc'],
    ['.eslintrc.json', 'jsonc'],
    ['deno.json', 'jsonc'],
    ['data.json', 'json'],
    ['mytsconfig.json', 'json'],
    ['vscode/settings.json', 'json'],
    ['stdin', 'json'],
  ])('%s is %s', (name, dialect) => {
    expect(detectDialect(name)).toBe(dialect);
  });

  it('lets a flag decide', () => {
    expect(detectDialect('tsconfig.json', 'json')).toBe('json');
    expect(DIALECT_LABELS).toEqual({ json: 'JSON', jsonc: 'JSON with comments', jsonl: 'JSON Lines' });
  });
});

describe('DocumentError', () => {
  it('carries details', () => {
    const error = new DocumentError('bad', { line: 3, column: 4 });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'DocumentError', message: 'bad', line: 3, column: 4 });
    expect(new DocumentError('plain').line).toBeUndefined();
  });
});

describe('codeFrame', () => {
  const text = ['{', '  "a": 1,', '  "b": [1, 2', '', '  "c": 3', '}'].join('\n');
  const shown = { showSecrets: true };

  it('shows the lines around a position with a caret', () => {
    expect(codeFrame(text, 3, 13, shown)).toBe(['  1 | {', '  2 |   "a": 1,', '> 3 |   "b": [1, 2', '    |             ^', '  4 | ', '  5 |   "c": 3'].join('\n'));
  });

  it('hides the values, keeping the caret on the same spot', () => {
    expect(codeFrame(text, 3, 13)).toBe(['  1 | {', '  2 |   "a": ***,', '> 3 |   "b": [***, ***', `    | ${' '.repeat(16)}^`, '  4 | ', '  5 |   "c": ***'].join('\n'));
    expect(codeFrame('{"a": 1,}', 1, 8)).toBe(['> 1 | {"a": ***,}', `    | ${' '.repeat(9)}^`].join('\n'));
  });

  it('clips at the start and end of the text and honours the context size', () => {
    expect(codeFrame('[1,\n2', 1, 1, { context: 0, ...shown })).toBe(['> 1 | [1,', '    | ^'].join('\n'));
    expect(codeFrame('[1,\n2', 2, 2, { context: 5, ...shown })).toBe(['  1 | [1,', '> 2 | 2', '    |  ^'].join('\n'));
    expect(codeFrame('[1]', 9, 1)).toBe('');
    expect(codeFrame('[1]\n2', 3, 1, { context: 1 })).toBe('  2 | ***');
  });

  it('numbers lines from an offset and widens the gutter to fit', () => {
    expect(codeFrame('{"x": tru}', 1, 7, { context: 0, lineOffset: 99 })).toBe(['> 100 | {"x": ***}', '      |       ^'].join('\n'));
  });

  it('windows very long lines around the column', () => {
    const long = `[${'1,'.repeat(100)}x]`;
    const frame = codeFrame(long, 1, 150, { context: 0, width: 20, ...shown }).split('\n');
    expect(frame[0]).toBe(`> 1 | …${long.slice(139, 159)}…`);
    expect(frame[1].indexOf('^') - frame[0].indexOf('|') - 2).toBe(150 - 1 - 139 + 1);
    expect(codeFrame(long, 1, 3, { context: 0, width: 20, ...shown }).split('\n')[0]).toBe(`> 1 | ${long.slice(0, 20)}…`);
    expect(codeFrame(long, 1, 203, { context: 0, width: 20, ...shown }).split('\n')[0]).toBe(`> 1 | …${long.slice(-20)}`);
    expect(codeFrame(`${long}\n2`, 2, 1, { context: 1, width: 20, ...shown }).split('\n')[0]).toBe(`  1 | ${long.slice(0, 20)}…`);
    // Hidden values make the line shorter first; the window is taken from the masked line.
    const masked = codeFrame(long, 1, 203, { context: 0, width: 20 }).split('\n');
    expect(masked[0]).toBe('> 1 | …***,***,***,***,***]');
    expect(masked[1].indexOf('^') - masked[0].indexOf('|') - 2).toBe(20);
  });

  it('turns tabs into spaces, strips carriage returns and defuses control characters', () => {
    expect(codeFrame('\t[1,\r\n]', 1, 2, { context: 0, ...shown })).toBe(['> 1 |  [1,', '    |  ^'].join('\n'));
    expect(codeFrame('["\u001b]0;title\u0007", \u001b]', 1, 3, { context: 0, ...shown }).split('\n')[0]).toBe('> 1 | ["?]0;title?", ?]');
  });

  it('shows values only when asked', () => {
    const line = `{"password": "${FAKE.password}", "x": }`;
    expect(codeFrame(line, 1, 30, { context: 0 })).toContain('"password": "***"');
    expect(codeFrame(line, 1, 30, { context: 0, showSecrets: true })).toContain(`"password": "${FAKE.password}"`);
  });
});

describe('jsoncToJson', () => {
  it('removes comments and trailing commas, keeping every token as written', () => {
    const text = '// head\n{\n  "a": 1.50, /* inline */ "b": [1, 2,],\n  "c": {"d": "x // not a comment",},\n}\n';
    expect(jsoncToJson(text)).toBe('{"a":1.50,"b":[1,2],"c":{"d":"x // not a comment"}}');
  });
});

describe('parseText', () => {
  it('parses JSON exactly, dropping a byte order mark', () => {
    const result = parseText('\uFEFF{"n": 12345678901234567890}', 'json');
    expect(result.ok).toBe(true);
    expect(result.value.n).toEqual(new RawNumber('12345678901234567890'));
    expect(result.json).toBe('{"n": 12345678901234567890}');
    expect(parseText('[1]', 'json').json).toBe('[1]');
  });

  it('parses JSONC into plain JSON text', () => {
    expect(parseText('\uFEFF// c\n[1, 2.0,]', 'jsonc')).toEqual({ ok: true, value: [1, new RawNumber('2.0')], json: '[1,2.0]' });
  });

  it('reports empty and invalid documents', () => {
    expect(parseText(' \n', 'jsonc')).toEqual({ ok: false, empty: true, error: null });
    const jsonc = parseText('{"a": }', 'jsonc');
    expect(jsonc).toMatchObject({ ok: false, empty: false, error: { line: 1, column: 7 } });
    const json = parseText('{"a": 1,}', 'json');
    expect(json).toMatchObject({ ok: false, error: { line: 1, column: 8 } });
  });
});

describe('parseLine', () => {
  it('parses one record, allowing blank lines', () => {
    expect(parseLine('  ', 4)).toEqual({ blank: true });
    expect(parseLine('{"a":1}', 1)).toEqual({ ok: true, value: { a: 1 } });
    expect(parseLine('{"a":', 7)).toMatchObject({ ok: false, error: { line: 7, recordLine: 7 } });
  });
});

describe('parseDocument', () => {
  const input = (text, name = 'data.json') => ({ text, name });

  it('parses JSON and JSONC documents', () => {
    expect(parseDocument(input('{"a": [1, 2]}'), 'json')).toEqual({ value: { a: [1, 2] }, json: '{"a": [1, 2]}' });
    expect(parseDocument(input('{"a": 1, /* c */}'), 'jsonc')).toEqual({ value: { a: 1 }, json: '{"a":1}' });
  });

  it('turns JSON Lines into a list of records', () => {
    expect(parseDocument(input('\uFEFF{"a":1}\r\n\n  [2]  \n"x"'), 'jsonl')).toEqual({ value: [{ a: 1 }, [2], 'x'], json: '[{"a":1},\n[2],\n"x"]', records: 3, skipped: [] });
    expect(parseDocument(input(''), 'jsonl')).toEqual({ value: [], json: '[]', records: 0, skipped: [] });
  });

  it('stops at an invalid line, or skips it when asked', () => {
    expect(() => parseDocument(input('{"a":1}\n{"token": "abc", oops}\n', 'x.jsonl'), 'jsonl')).toThrow(
      'x.jsonl is not valid JSON Lines: line 2, column 18: Property names must be wrapped in double quotes\n> 2 | {"token": "***", ***}\n    |                  ^'
    );
    let error;
    try {
      parseDocument(input('1\n{', 'x.jsonl'), 'jsonl');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DocumentError);
    expect(error).toMatchObject({ line: 2, column: 2 });
    const result = parseDocument(input('1\nnope\n3'), 'jsonl', { skipInvalidLines: true });
    expect(result.value).toEqual([1, 3]);
    expect(result.skipped).toEqual([expect.objectContaining({ line: 2, column: 1 })]);
  });

  it('shows secrets in error excerpts only when asked', () => {
    expect(() => parseDocument(input(`{"password": "${FAKE.password}",}`), 'json', { showSecrets: true })).toThrow(`"password": "${FAKE.password}"`);
    expect(() => parseDocument(input(`{"password": "${FAKE.password}"}\n{`, 'x.jsonl'), 'jsonl', { showSecrets: true })).not.toThrow(FAKE.password);
  });

  it('explains invalid and empty documents', () => {
    expect(() => parseDocument(input('', 'empty.jsonc'), 'jsonc')).toThrow('empty.jsonc is empty.');
    expect(() => parseDocument(input('  ', 'blank.json'), 'json')).toThrow('blank.json is empty.');
    expect(() => parseDocument(input('{"a": 1,}', 'x.json'), 'json')).toThrow("x.json is not valid JSON: Trailing comma before '}' is not allowed (line 1, column 8).\n> 1 | {\"a\": ***,}\n    |          ^");
    expect(() => parseDocument(input('{a: 1}', 'conf.json5'), 'json')).toThrow('JSON5 is not JSON: run `repair` to convert it.');
    expect(() => parseDocument(input('{"a" 1}', 'c.jsonc'), 'jsonc')).toThrow('c.jsonc is not valid JSON with comments:');
    let error;
    try {
      parseDocument(input('[1,]'), 'json');
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ name: 'DocumentError', line: 1, column: 3 });
  });
});

describe('findWarnings', () => {
  it('reports duplicate keys at every level', () => {
    expect(findWarnings('{"a": 1, "b": {"x": 1, "x": 2}, "a": [{"a": 1}]}')).toEqual([
      { kind: 'duplicate-key', line: 1, column: 24, message: 'Duplicate key "x": most parsers keep only the last value.' },
      { kind: 'duplicate-key', line: 1, column: 33, message: 'Duplicate key "a": most parsers keep only the last value.' },
    ]);
  });

  it('limits the number of duplicate-key warnings', () => {
    expect(findWarnings('{"a":1,"a":2,"a":3,"a":4}', { limit: 2 })).toHaveLength(2);
  });

  it('summarizes numbers that lose precision as doubles', () => {
    expect(findWarnings('[1.50, 0.1, 1e2, -0, 12345678901234567890, 9007199254740993]')).toEqual([
      {
        kind: 'imprecise-number',
        line: 1,
        column: 22,
        message: '2 numbers cannot be represented exactly as double-precision floats (JavaScript and many JSON libraries would round them); the first is on this line.',
      },
    ]);
    expect(findWarnings('\n[0.30000000000000000001]', { lineOffset: 10 })[0]).toMatchObject({
      line: 12,
      column: 2,
      message: '1 number cannot be represented exactly as double-precision floats (JavaScript and many JSON libraries would round it).',
    });
  });

  it('reads JSONC when asked', () => {
    expect(findWarnings('// c\n{"a": 1, "a": 2,}', { jsonc: true })).toHaveLength(1);
  });

  it('gives up quietly on nesting too deep to scan', () => {
    expect(findWarnings(`${'['.repeat(100000)}${']'.repeat(100000)}`)).toEqual([]);
  });
});
