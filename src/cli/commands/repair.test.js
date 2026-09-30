/** @jest-environment node */
import fs from 'node:fs';
import { jsonrepair } from 'jsonrepair';
import { FAKE } from '../testing/fakeSecrets';
import { makeWorkspace } from '../testing/workspace';
import { commentSpans, describeChanges, repairKeepingComments, stripComments } from './repair';

jest.mock('jsonrepair', () => {
  const actual = jest.requireActual('jsonrepair');
  return { ...actual, jsonrepair: jest.fn(actual.jsonrepair) };
});

const BROKEN = "{\n  'name': 'Ada',\n  age: 36,\n  \"tags\": [\"x\",],\n  \"ok\": True\n}\n";
const FIXED = '{\n  "name": "Ada",\n  "age": 36,\n  "tags": ["x"],\n  "ok": true\n}\n';

let ws;
beforeEach(() => {
  // The project's Jest setup resets mocks before each test; restore the real implementation.
  jsonrepair.mockImplementation(jest.requireActual('jsonrepair').jsonrepair);
  ws = makeWorkspace({ 'broken.json': BROKEN });
});
afterEach(() => {
  ws.cleanup();
  jest.restoreAllMocks();
});

describe('repair', () => {
  it('prints the repaired JSON and counts the changes', async () => {
    expect(await ws.run(['repair', 'broken.json'])).toEqual({
      code: 0,
      stdout: FIXED,
      stderr: 'Repaired broken.json: 5 changes. Add --diff to see them, or -i to fix the file in place.\n',
    });
    ws.write('nonl.json', "{'a': 1}");
    expect((await ws.run(['repair', 'nonl.json'])).stdout).toBe('{"a": 1}\n');
  });

  it('shows a line diff of the changes', async () => {
    const { code, stdout, stderr } = await ws.run(['repair', 'broken.json', '--diff']);
    expect(code).toBe(0);
    expect(stdout).toBe(
      [
        '--- broken.json',
        '+++ broken.json (repaired)',
        '@@ -1,7 +1,7 @@',
        ' {',
        "-  'name': 'Ada',",
        '-  age: 36,',
        '-  "tags": ["x",],',
        '-  "ok": True',
        '+  "name": "Ada",',
        '+  "age": 36,',
        '+  "tags": ["x"],',
        '+  "ok": true',
        ' }',
        ' ',
        '',
      ].join('\n')
    );
    expect(stderr).toBe('5 changes in total. Use -i to fix the file in place or -o <file> to save the result.\n');
  });

  it('shows snippets for minified files', async () => {
    ws.write('min.json', `{"a": [1, 2,], ${'"pad": 0, '.repeat(50)}"b": None}`);
    expect((await ws.run(['repair', 'min.json', '--diff'])).stdout).toBe(
      ['line 1, column 12:', '  - {"a": [1, 2,], "pad": 0, "pad": 0, "…', '  + {"a": [1, 2], "pad": 0, "pad": 0, "…', 'line 1, column 521:', '  - …pad": 0, "pad": 0, "b": None}', '  + …pad": 0, "pad": 0, "b": null}', ''].join('\n')
    );
  });

  it('writes the result to a file or back to the input', async () => {
    fs.chmodSync(ws.file('broken.json'), 0o640);
    expect(await ws.run(['repair', 'broken.json', '-o', 'fixed.json', '--diff'])).toMatchObject({ code: 0, stdout: expect.stringMatching(/^Repaired broken\.json \(5 changes\) → fixed\.json\.\n--- broken\.json\n/) });
    expect(ws.read('fixed.json')).toBe(FIXED);
    expect(ws.mode('fixed.json')).toBe(0o640);
    ws.write('crlf.json', `﻿${BROKEN.replace(/\n/g, '\r\n')}`);
    expect((await ws.run(['repair', 'crlf.json', '-i'])).stdout).toBe('Repaired crlf.json (5 changes) → crlf.json.\n');
    expect(ws.read('crlf.json')).toBe(`﻿${FIXED.replace(/\n/g, '\r\n')}`);
    ws.write('crlf2.json', `﻿${BROKEN.replace(/\n/g, '\r\n')}`);
    await ws.run(['repair', 'crlf2.json', '-o', 'out.json']);
    expect(ws.read('out.json')).toBe(FIXED.replace(/\n/g, '\r\n'));
  });

  it('can pretty-print the result', async () => {
    ws.write('flat.json', "{'a':[1,2,],'b':{'c':None}}");
    expect((await ws.run(['repair', 'flat.json', '--indent', '2'])).stdout).toBe('{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": null\n  }\n}\n');
    expect((await ws.run(['repair', 'flat.json', '--indent', 'wide'])).stderr).toContain('--indent expects 0–10 or "tab", got "wide".');
  });

  it('leaves valid files alone', async () => {
    ws.write('ok.json', '{"a": 1}');
    expect(await ws.run(['repair', 'ok.json', '-i'])).toEqual({ code: 0, stdout: '', stderr: 'ok.json is already valid JSON; nothing to repair.\n' });
    ws.write('tsconfig.json', '{\n  // comment\n  "a": 1,\n}');
    expect((await ws.run(['repair', 'tsconfig.json'])).stderr).toBe('tsconfig.json is already valid JSON with comments; nothing to repair.\n');
  });

  it('repairs JSON Lines record by record, keeping one record per line', async () => {
    ws.write('events.jsonl', "{\"a\": 1}\n\n{'b': 2,}\n{c: True}\n");
    expect((await ws.run(['repair', 'events.jsonl'])).stdout).toBe('{"a": 1}\n\n{"b":2}\n{"c":true}\n');
    ws.write('ok.jsonl', '{"a": 1}\n');
    expect((await ws.run(['repair', 'ok.jsonl'])).stderr).toBe('ok.jsonl is already valid JSON Lines; nothing to repair.\n');
    ws.write('hopeless.jsonl', '{"a": 1}\n]\n');
    expect((await ws.run(['repair', 'hopeless.jsonl'])).stderr).toBe(
      'json-explorer: hopeless.jsonl line 2 could not be repaired automatically: Unexpected end of json string at position 1. Run validate to see the first problem.\n'
    );
  });

  it('masks secrets in the changes it shows, unless asked', async () => {
    ws.write('secret.json', `{\n  'password': '${FAKE.password}',\n  api_token: '${FAKE.githubToken}',\n  user: 'ada',\n}\n`);
    const masked = await ws.run(['repair', 'secret.json', '--diff']);
    expect(masked.stdout).not.toContain(FAKE.password);
    expect(masked.stdout).not.toMatch(/ghp_/);
    expect(masked.stdout).toContain(`-  'password': '[REDACTED]',`);
    expect(masked.stdout).toContain(`+  "password": "[REDACTED]",`);
    expect(masked.stdout).toContain(`+  "user": "ada"`);
    const shown = await ws.run(['repair', 'secret.json', '--diff', '--show-secrets']);
    expect(shown.stdout).toContain(`-  'password': '${FAKE.password}',`);
    expect(shown.stdout).toContain(FAKE.githubToken);
    ws.write('min.json', `{'password': '${FAKE.password}', 'n': 1,}`);
    expect((await ws.run(['repair', 'min.json', '--diff'])).stdout).toBe(`line 1, column 2:\n  - {'password': '[REDACTED]', 'n': 1,}\n  + {"password": "[REDACTED]", "n": 1}\n`);
  });

  it('explains what it cannot repair', async () => {
    ws.write('hopeless.json', ']');
    const { code, stderr } = await ws.run(['repair', 'hopeless.json']);
    expect(code).toBe(2);
    expect(stderr).toBe('json-explorer: hopeless.json could not be repaired automatically: Unexpected end of json string at position 1. Run validate to see the first problem.\n');
    jsonrepair.mockReturnValueOnce('{still broken');
    expect((await ws.run(['repair', 'broken.json'])).stderr).toBe('json-explorer: broken.json could not be fully repaired.\n');
  });

  it('describes very extensive changes briefly', async () => {
    const lines = Array.from({ length: 1500 }, (_, index) => `{'n': ${index}},`);
    ws.write('many.json', `[\n${lines.join('\n')}\n]\n`);
    const { stdout, stderr } = await ws.run(['repair', 'many.json', '--diff']);
    expect(stdout).toBe('The changes are too extensive to list (the document was largely rewritten).\n');
    expect(stderr).toBe('many changes in total. Use -i to fix the file in place or -o <file> to save the result.\n');
  });

  it('explains empty files, and --indent where it does not apply', async () => {
    ws.write('empty.json', '  \n');
    expect(await ws.run(['repair', 'empty.json'])).toEqual({ code: 2, stdout: '', stderr: 'json-explorer: empty.json is empty; there is nothing to repair.\n' });
    ws.write('log.jsonl', "{'a': 1}\n");
    expect((await ws.run(['repair', 'log.jsonl', '--indent', '2'])).stderr).toContain('--indent does not apply to JSON Lines: each record stays on one line.');
  });

  it('checks its options', async () => {
    expect((await ws.run(['repair', 'broken.json', '-o', 'x.json', '-i'])).stderr).toContain('Use either -o <file> or -i, not both.');
    expect((await ws.run(['repair', '-', '-i'])).stderr).toContain('-i needs a file (stdin cannot be edited in place).');
    expect((await ws.run(['repair'])).stderr).toContain('Usage: json-explorer repair <file>');
  });

  it('reads stdin', async () => {
    expect((await ws.run(['repair', '-'], { stdin: "{'a': None}" })).stdout).toBe('{"a": null}\n');
  });
});

describe('repairing JSON with comments', () => {
  it('keeps the comments of a JSONC file around the repair', async () => {
    const broken = '{\n  // compiler options\n  "strict": true\n  /* paths */\n  "paths": {"@/*": [\'src/*\']},\n}\n';
    ws.write('tsconfig.json', broken);
    const { code, stdout } = await ws.run(['repair', 'tsconfig.json', '-i']);
    expect(code).toBe(0);
    expect(stdout).toBe(`Repaired tsconfig.json (3 changes) → tsconfig.json.\n`);
    expect(ws.read('tsconfig.json')).toBe('{\n  // compiler options\n  "strict": true,\n  /* paths */\n  "paths": {"@/*": ["src/*"]}\n}\n');
  });

  it('refuses to drop comments in place when they cannot be kept, and says so otherwise', async () => {
    // Here the repair would turn the comment into part of a string.
    ws.write('settings.jsonc', '{a: hello /* note */ world}');
    const inPlace = await ws.run(['repair', 'settings.jsonc', '-i']);
    expect(inPlace.code).toBe(2);
    expect(inPlace.stderr).toContain('Repairing settings.jsonc would remove its comments. Use -o <file> to write the repaired JSON without them');
    expect(ws.read('settings.jsonc')).toBe('{a: hello /* note */ world}');
    const printed = await ws.run(['repair', 'settings.jsonc']);
    expect(printed.stdout).toBe('{"a": "hello world"}\n');
    expect(printed.stderr).toContain('Note: the repaired JSON has no comments: they could not be kept around this repair.');
    // A .json file cannot have comments: the repair removes them and says so.
    ws.write('notes.json', "{name: 'x', // who\n count: 1}");
    const plain = await ws.run(['repair', 'notes.json']);
    expect(plain.stdout).toBe('{"name": "x",\n "count": 1}\n');
    expect(plain.stderr).toContain('Note: 1 comment removed, since JSON does not allow comments. If notes.json is meant to have them (JSONC), repair it with --jsonc to keep them.');
    // Pretty-printing rewrites the whole text, so comments cannot be kept either.
    ws.write('tsconfig.json', '{\n  // c\n  "a": 1\n  "b": 2\n}');
    expect((await ws.run(['repair', 'tsconfig.json', '--indent', '2'])).stdout).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
  });

  it('finds comments at the start of a line or after a blank, outside strings', () => {
    const text = '// a\n{"u": "http://x", \'s\': \'/* no */\', "e": "\\"//", b: 1 /* c\n d */, url: http://y}';
    expect(commentSpans(text).map(([start, end]) => text.slice(start, end))).toEqual(['// a', '/* c\n d */']);
    expect(commentSpans('[1] /* open')).toEqual([[4, 11]]);
    expect(commentSpans('x\r\n// y\r\n')).toEqual([[3, 7]]);
  });

  it('gives up when the repair would reach into a comment, or changes too much', () => {
    expect(repairKeepingComments('{"a": 1}')).toBeNull();
    expect(repairKeepingComments('{"a": 1 /* c */')).toBe('{"a": 1} /* c */');
    // A comment inside what the repair deletes.
    jsonrepair.mockImplementationOnce(() => '[1]');
    expect(repairKeepingComments('[1, /* x */ 2]')).toBeNull();
    // An insertion inside a comment.
    jsonrepair.mockImplementationOnce((text) => `${text.slice(0, 6)}!${text.slice(6)}`);
    expect(repairKeepingComments('[1 /* x */]')).toBeNull();
    jsonrepair.mockImplementationOnce(() => {
      throw new Error('cannot');
    });
    expect(repairKeepingComments('[1 // x\n')).toBeNull();
    // Line breaks inside a comment stay (CRLF too).
    expect(repairKeepingComments('[1 /* a\r\n b */ 2]')).toBe('[1, /* a\r\n b */ 2]');
    // Thousands of edits: too many to map back.
    const keys = Array.from({ length: 700 }, (_, index) => `'k${index}': 1`).join(', ');
    expect(repairKeepingComments(`// many\n{${keys}}`)).toBeNull();
  });
});

describe('stripComments', () => {
  it.each([
    ['{\n  // c\n  "a": 1, // one\n  /* multi\n     line */\n  "b": 2 /* inline */\n}', '{\n  "a": 1,\n  "b": 2\n}'],
    ['// head\r\n{"a": 1}\r\n// tail\r\n', '{"a": 1}\r\n'],
    ['{"a": "x // not", /* c */ "b": 1}', '{"a": "x // not", "b": 1}'],
    ["{'a': 'y /* not */', \"b\": \"it\\\"s // not\"}", "{'a': 'y /* not */', \"b\": \"it\\\"s // not\"}"],
    ['{url: http://example.com/*x}', '{url: http://example.com/*x}'],
    ['{"a": "unterminated\n// comment\n"b": 2}', '{"a": "unterminated\n"b": 2}'],
    ['{"a": 1} /* never closed', '{"a": 1}'],
    ['/* only a comment */', ''],
    ['', ''],
  ])('%j', (input, output) => {
    expect(stripComments(input)).toBe(output);
  });
});

describe('describeChanges', () => {
  it('uses snippets for a text on one line or with very long lines, and line diffs otherwise', () => {
    expect(describeChanges("{'a': 1}", '{"a": 1}', { from: 'a', to: 'b' })).toBe(`line 1, column 2:\n  - {'a': 1}\n  + {"a": 1}`);
    expect(describeChanges("{'a': 1}\n", '{"a": 1}\n', { from: 'a', to: 'b' })).toBe(`line 1, column 2:\n  - {'a': 1} ⏎ \n  + {"a": 1} ⏎ `);
    expect(describeChanges('[\n1,\n2,\n]', '[\n1,\n2\n]', { from: 'a', to: 'b' })).toBe('--- a\n+++ b\n@@ -1,4 +1,4 @@\n [\n 1,\n-2,\n+2\n ]');
    // Two short lines: a line diff, so nothing after the comment reads as part of it.
    expect(describeChanges("{name: 'x', // c1\n count: None}", '{"name": "x", "count": null}', { from: 'a', to: 'b' })).toBe(
      '--- a\n+++ b\n@@ -1,2 +1,1 @@\n-{name: \'x\', // c1\n- count: None}\n+{"name": "x", "count": null}'
    );
    const long = `{"a": "${'x'.repeat(500)}",\n'b': 1}`;
    expect(describeChanges(long, long.replace("'b'", '"b"'), { from: 'a', to: 'b' })).toMatch(/^line 2, column 1:\n {2}- …x+", ⏎ 'b': 1}\n {2}\+ …x+", ⏎ "b": 1}$/);
  });
});
