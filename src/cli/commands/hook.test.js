/** @jest-environment node */
import fs from 'node:fs';
import { FAKE } from '../testing/fakeSecrets';
import { makeWorkspace } from '../testing/workspace';

let ws;
beforeEach(() => {
  ws = makeWorkspace();
});
afterEach(() => ws.cleanup());

const event = (filePath, extra = {}) => JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: filePath }, cwd: ws.cwd, ...extra });

describe('hook', () => {
  it('stays silent for valid files and files that are not JSON', async () => {
    ws.write('ok.json', '{"a": 1}');
    ws.write('notes.txt', '{"a": ');
    expect(await ws.run(['hook'], { stdin: event('ok.json') })).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(await ws.run(['hook'], { stdin: event('notes.txt') })).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(await ws.run(['hook'], { stdin: JSON.stringify({ tool_input: {} }) })).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('reports a JSON file an edit broke, with its location (values hidden) and a repair preview command', async () => {
    const file = ws.write('config.json', '{\n  "name": "demo",\n  "port": 8080,\n}\n');
    const { code, stdout, stderr } = await ws.run(['hook'], { stdin: event('config.json') });
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toBe(
      [
        "JSON Explorer: config.json is not valid JSON after this edit: Trailing comma before '}' is not allowed (line 3, column 15).",
        '  1 | {',
        '  2 |   "name": "***",',
        '> 3 |   "port": ***,',
        '    |              ^',
        '  4 | }',
        '  5 | ',
        `Fix the file. To see how common mistakes would be repaired: node '/skills/json-explorer/scripts/json-explorer.mjs' repair '${file}' --diff`,
        '',
      ].join('\n')
    );
  });

  it('never shows values from the file, wherever the secret sits', async () => {
    ws.write('secrets.json', `{\n  "password":\n    "${FAKE.password}-next-line",\n  "nested": {"pass": "${FAKE.password}-nested"},,\n  "bare": ${FAKE.password}bare\n}`);
    const { code, stderr } = await ws.run(['hook'], { stdin: event('secrets.json') });
    expect(code).toBe(2);
    expect(stderr).not.toContain(FAKE.password);
  });

  it('stays silent when the file was already broken before the edit', async () => {
    ws.write('old.json', '{"a": 1,, "b": 2}');
    const edit = (originalFile) => event('old.json', { tool_name: 'Edit', tool_response: { filePath: 'old.json', originalFile } });
    expect(await ws.run(['hook'], { stdin: edit('{"a": 1,, "b": 1}') })).toEqual({ code: 0, stdout: '', stderr: '' });
    // A valid (or empty) file before the edit: the edit broke it.
    expect((await ws.run(['hook'], { stdin: edit('{"a": 1, "b": 1}') })).code).toBe(2);
    expect((await ws.run(['hook'], { stdin: edit('  ') })).code).toBe(2);
  });

  it('leaves .json files that already used comments alone, and says what to do when an edit adds them', async () => {
    ws.write('settings.json', '{\n  // font\n  "size": 14,\n}');
    const edit = (originalFile) => event('settings.json', { tool_name: 'Edit', tool_response: { originalFile } });
    expect((await ws.run(['hook'], { stdin: edit('{\n  // font\n  "size": 12,\n}') })).code).toBe(0);
    const added = await ws.run(['hook'], { stdin: edit('{"size": 12}') });
    expect(added.code).toBe(2);
    expect(added.stderr).toContain('Comments are not allowed in JSON');
    expect(added.stderr).toMatch(/If this file is meant to allow comments \(JSONC.*\), leave it as it is; otherwise remove them\.\n$/);
    expect(added.stderr).not.toContain('repair');
  });

  it('quotes file names safely in the command it suggests', async () => {
    const tricky = ws.write("cfg$(touch PWNED)`id`'s.json", '[1,');
    const { stderr } = await ws.run(['hook'], { stdin: event(tricky) });
    expect(stderr).toContain(`repair '${tricky.replace(/'/g, "'\\''")}' --diff`);
    const newline = ws.write('two\nlines.json', '[1,');
    const shown = await ws.run(['hook'], { stdin: event(newline) });
    expect(shown.stderr).toMatch(/^JSON Explorer: .*two\?lines\.json is not valid JSON/);
    expect(shown.stderr).toContain('run json-explorer repair on it with --diff');
  });

  it('reads large events', async () => {
    ws.write('big.json', '[1,');
    expect((await ws.run(['hook'], { stdin: event('big.json', { tool_input: { file_path: 'big.json', content: 'x'.repeat(2 * 1024 * 1024) } }) })).code).toBe(2);
  });

  it('checks JSONC and JSON Lines by their own rules', async () => {
    ws.write('.vscode/settings.json', '{\n  // ok here\n  "a": 1,\n}');
    expect((await ws.run(['hook'], { stdin: event(ws.file('.vscode/settings.json')) })).code).toBe(0);
    ws.write('tsconfig.json', '{"a": }');
    const jsonc = await ws.run(['hook'], { stdin: event('tsconfig.json') });
    expect(jsonc.code).toBe(2);
    expect(jsonc.stderr).toMatch(/^JSON Explorer: tsconfig\.json is not valid JSON with comments after this edit: .*\n> 1 \| \{"a": \}\n.*\nFix the file\.\n$/);
    ws.write('events.jsonl', '﻿{"a":1}\n{"a":2}\n{"a":\n');
    const jsonl = await ws.run(['hook'], { stdin: event('events.jsonl') });
    expect(jsonl.code).toBe(2);
    expect(jsonl.stderr).toBe('JSON Explorer: events.jsonl is not valid JSON Lines after this edit: Unexpected end of input — the JSON is incomplete (line 3, column 6).\n> 3 | {"a":\n    |      ^\nFix the file.\n');
    ws.write('good.ndjson', '﻿{"a":1}\n\n{"a":2}\n');
    expect((await ws.run(['hook'], { stdin: event('good.ndjson') })).code).toBe(0);
  });

  it('reports files left empty', async () => {
    ws.write('empty.json', '');
    expect(await ws.run(['hook'], { stdin: event('empty.json') })).toEqual({
      code: 2,
      stdout: '',
      stderr: `JSON Explorer: empty.json is not valid JSON after this edit: the file is empty (line 1, column 1).\nFix the file. To see how common mistakes would be repaired: node '/skills/json-explorer/scripts/json-explorer.mjs' repair '${ws.file('empty.json')}' --diff\n`,
    });
  });

  it('resolves paths against the event directory, or its own', async () => {
    ws.write('sub/bad.json', '[1,');
    expect((await ws.run(['hook'], { stdin: event('bad.json', { cwd: ws.file('sub') }) })).code).toBe(2);
    expect((await ws.run(['hook'], { stdin: event('sub/bad.json', { cwd: 42 }) })).code).toBe(2);
  });

  it('never gets in the way when it cannot check', async () => {
    const quiet = { code: 0, stdout: '', stderr: '' };
    expect(await ws.run(['hook'], { stdin: 'not json' })).toEqual(quiet);
    expect(await ws.run(['hook'], { stdin: event('missing.json') })).toEqual(quiet);
    fs.mkdirSync(ws.file('dir.json'));
    expect(await ws.run(['hook'], { stdin: event('dir.json') })).toEqual(quiet);
    ws.write('binary.json', Buffer.from([0x7b, 0x00]));
    expect(await ws.run(['hook'], { stdin: event('binary.json') })).toEqual(quiet);
    ws.write('huge.json', Buffer.alloc(10 * 1024 * 1024 + 1, 0x20));
    expect(await ws.run(['hook'], { stdin: event('huge.json') })).toEqual(quiet);
  });

  it('can be turned off', async () => {
    ws.write('bad.json', '[');
    expect(await ws.run(['hook'], { stdin: event('bad.json'), env: { JSON_EXPLORER_HOOK: 'off' } })).toEqual({ code: 0, stdout: '', stderr: '' });
  });
});
