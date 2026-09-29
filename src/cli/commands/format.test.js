/** @jest-environment node */
import fs from 'node:fs';
import { makeWorkspace } from '../testing/workspace';

const MIN = '{"b":1.50,"a":[12345678901234567890,"\\u00e9"],"c":{}}';
const PRETTY = '{\n  "b": 1.50,\n  "a": [\n    12345678901234567890,\n    "\\u00e9"\n  ],\n  "c": {}\n}\n';
const SORTED = '{\n  "a": [\n    12345678901234567890,\n    "\\u00e9"\n  ],\n  "b": 1.50,\n  "c": {}\n}\n';

let ws;
beforeEach(() => {
  ws = makeWorkspace({ 'min.json': MIN, 'pretty.json': PRETTY });
});
afterEach(() => ws.cleanup());

describe('format', () => {
  it('will not put a JSONC file on one line', async () => {
    ws.write('conf.jsonc', '{\n  // c\n  "a": 1\n}');
    const { code, stderr } = await ws.run(['format', 'conf.jsonc', '--indent', '0']);
    expect(code).toBe(2);
    expect(stderr).toContain('--indent 0 would put everything on one line, with no room for comments: use minify to drop them, or an indent of 1 or more.');
  });

  it('pretty-prints losslessly', async () => {
    expect(await ws.run(['format', 'min.json'])).toEqual({ code: 0, stdout: PRETTY, stderr: '' });
  });

  it('uses the requested indentation', async () => {
    expect((await ws.run(['format', 'min.json', '--indent', '4'])).stdout).toBe(PRETTY.replace(/^( +)/gm, (spaces) => spaces.repeat(2)));
    expect((await ws.run(['format', 'min.json', '--indent', 'tab'])).stdout).toBe(PRETTY.replace(/^( +)/gm, (spaces) => '\t'.repeat(spaces.length / 2)));
    expect((await ws.run(['format', 'min.json', '--indent', '0'])).stdout).toBe(`${MIN}\n`);
    for (const bad of ['x', '11', '-1', '1.5']) {
      expect((await ws.run(['format', 'min.json', '--indent', bad])).stderr).toContain(`--indent expects 0–10 or "tab", got "${bad}".`);
    }
  });

  it('omits the final newline on request', async () => {
    expect((await ws.run(['format', 'min.json', '--no-final-newline'])).stdout).toBe(PRETTY.trimEnd());
  });

  it('writes to a file, keeping a private input private', async () => {
    fs.chmodSync(ws.file('min.json'), 0o600);
    expect(await ws.run(['format', 'min.json', '-o', 'out.json'])).toEqual({ code: 0, stdout: 'Wrote out.json.\n', stderr: '' });
    expect(ws.read('out.json')).toBe(PRETTY);
    expect(ws.mode('out.json')).toBe(0o600);
  });

  it('rewrites files in place, keeping byte order marks and line endings', async () => {
    ws.write('crlf.json', `\uFEFF${MIN}\r\n`);
    expect(await ws.run(['format', 'crlf.json', 'pretty.json', '-i'])).toEqual({ code: 0, stdout: '✎ crlf.json\n✓ pretty.json (unchanged)\n', stderr: '' });
    expect(ws.read('crlf.json')).toBe(`\uFEFF${PRETTY.replace(/\n/g, '\r\n')}`);
  });

  it('checks formatting for CI', async () => {
    expect(await ws.run(['format', 'pretty.json', '--check'])).toEqual({ code: 0, stdout: '✓ pretty.json\n', stderr: '' });
    expect(await ws.run(['format', 'pretty.json', 'min.json', '--check'])).toEqual({ code: 1, stdout: '✓ pretty.json\n✗ min.json (would change)\n1 file OK, 1 would change.\n', stderr: '' });
    expect(ws.read('min.json')).toBe(MIN);
  });

  it('keeps comments when formatting JSONC', async () => {
    ws.write('tsconfig.json', '{// compiler\n"strict":true, /* all */ "paths":{"@/*":["src/*"],},}');
    expect((await ws.run(['format', 'tsconfig.json'])).stdout).toBe('{ // compiler\n  "strict": true, /* all */\n  "paths": {\n    "@/*": [\n      "src/*"\n    ],\n  },\n}\n');
    expect((await ws.run(['format', 'tsconfig.json', '--indent', 'tab'])).stdout).toBe('{ // compiler\n\t"strict": true, /* all */\n\t"paths": {\n\t\t"@/*": [\n\t\t\t"src/*"\n\t\t],\n\t},\n}\n');
  });

  it('formats JSON Lines one record per line', async () => {
    ws.write('e.jsonl', '{ "a" : 1 }\n\n[ 1 ,2 ]\n');
    expect(await ws.run(['format', 'e.jsonl'])).toEqual({ code: 0, stdout: '{"a":1}\n[1,2]\n', stderr: 'Note: JSON Lines keeps one record per line, so each record was written compactly.\n' });
    expect((await ws.run(['format', 'e.jsonl', '--check'])).stderr).toBe('');
    ws.write('blank.jsonl', '\n\n');
    expect((await ws.run(['format', 'blank.jsonl'])).stdout).toBe('');
  });

  it('refuses invalid and empty documents without changing them', async () => {
    ws.write('bad.json', '{"a": 1,}');
    const { code, stderr } = await ws.run(['format', 'bad.json', '-i']);
    expect(code).toBe(2);
    expect(stderr).toBe(
      "json-explorer: bad.json is not valid JSON: Trailing comma before '}' is not allowed (line 1, column 8). Nothing was changed; fix it first (json-explorer repair bad.json --diff).\n> 1 | {\"a\": ***,}\n    |          ^\n"
    );
    expect(ws.read('bad.json')).toBe('{"a": 1,}');
    expect((await ws.run(['format', '-'], { stdin: '[1,' })).stderr).toContain('fix it first (json-explorer repair - --diff)');
    ws.write('bad.jsonl', '{"a":1}\n{"b":\n');
    expect((await ws.run(['format', 'bad.jsonl'])).stderr).toMatch(/^json-explorer: bad\.jsonl is not valid JSON Lines: .* \(line 2, column 6\)\. Nothing was changed; .*\n {2}1 \| \{"a":\*\*\*\}\n> 2 \| \{"b":\n/);
    ws.write('empty.json', '');
    expect((await ws.run(['format', 'empty.json'])).stderr).toBe('json-explorer: empty.json is empty; nothing to format.\n');
  });

  it('checks its options', async () => {
    expect((await ws.run(['format'])).stderr).toContain('Usage: json-explorer format <file>... [-o <out> | -i | --check] [--indent 2|4|tab]');
    expect((await ws.run(['format', 'a.json', 'b.json'])).stderr).toContain('With several files, add -i to rewrite them or --check to test them.');
    expect((await ws.run(['format', 'min.json', '-i', '--check'])).stderr).toContain('Use only one of -o, -i and --check.');
    expect((await ws.run(['format', 'min.json', 'pretty.json', '--check', '--no-check', '-o', 'x.json'])).stderr).toContain('-o takes a single input file.');
    expect((await ws.run(['format', '-', '-i'])).stderr).toContain('-i needs files (stdin cannot be edited in place).');
  });
});

describe('minify', () => {
  it('removes insignificant whitespace losslessly', async () => {
    expect((await ws.run(['minify', 'pretty.json'])).stdout).toBe(`${MIN}\n`);
    expect((await ws.run(['minify', '--help'])).stdout).toContain('Usage: json-explorer minify <file>... [-o <out> | -i | --check]\n');
  });

  it('drops comments from JSONC, with a note', async () => {
    ws.write('settings.jsonc', '{\n  // c\n  "a": 1,\n}');
    expect(await ws.run(['minify', 'settings.jsonc'])).toEqual({ code: 0, stdout: '{"a":1}\n', stderr: 'Note: Comments were removed (minified JSON has no room for them).\n' });
  });

  it('minifies JSON Lines records', async () => {
    ws.write('e.jsonl', '{ "a" : 1 }\n');
    expect(await ws.run(['minify', 'e.jsonl'])).toEqual({ code: 0, stdout: '{"a":1}\n', stderr: '' });
  });
});

describe('sort-keys', () => {
  it('sorts keys at every level', async () => {
    expect((await ws.run(['sort-keys', 'min.json'])).stdout).toBe(SORTED);
    ws.write('e.jsonl', '{"b":1,"a":{"d":1,"c":2}}\n');
    expect((await ws.run(['sort-keys', 'e.jsonl'])).stdout).toBe('{"a":{"c":2,"d":1},"b":1}\n');
  });

  it('refuses to move comments around', async () => {
    ws.write('tsconfig.json', '{"b": 1, // c\n"a": 2}');
    expect((await ws.run(['sort-keys', 'tsconfig.json'])).stderr).toBe(
      'json-explorer: Sorting keys would move or drop the comments in tsconfig.json. Convert it to plain JSON first (json-explorer convert tsconfig.json --to json).\n'
    );
  });
});
