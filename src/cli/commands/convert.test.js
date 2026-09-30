/** @jest-environment node */
import fs from 'node:fs';
import * as convertUtils from '../../utils/convert';
import { makeWorkspace } from '../testing/workspace';

const USERS = '[{"id": 1, "name": "Ada", "address": {"city": "Paris"}, "big": 12345678901234567890}, {"id": 2, "name": "=cmd()", "tags": ["x"]}]';

let ws;
beforeEach(() => {
  ws = makeWorkspace({ 'user-list.json': USERS, 'api.json': `{"data": {"items": ${USERS}}, "total": 2}` });
});
afterEach(() => {
  ws.cleanup();
  jest.restoreAllMocks();
});

describe('convert', () => {
  it('infers TypeScript types named after the file', async () => {
    const { code, stdout } = await ws.run(['convert', 'user-list.json', '--to', 'ts']);
    expect(code).toBe(0);
    expect(stdout).toContain('export type UserList = UserListItem[];');
    expect(stdout).toContain('  tags?: string[];');
    expect((await ws.run(['convert', 'user-list.json', '--to', 'TypeScript', '--name', 'People'])).stdout).toContain('export type People = PeopleItem[];');
    ws.write('2024.json', '{"a": 1}');
    expect((await ws.run(['convert', '2024.json', '--to', 'ts'])).stdout).toContain('export interface Root {');
    expect((await ws.run(['convert', '-', '--to', 'ts'], { stdin: '{"a": 1}' })).stdout).toContain('export interface Root {');
  });

  it('describes records when a path selects several values or the input is JSON Lines', async () => {
    expect((await ws.run(['convert', 'api.json', '--path', '$.data.items[*]', '--to', 'ts'])).stdout).toMatch(/^export interface Item \{/);
    expect((await ws.run(['convert', 'api.json', '--path', '$..*[?@.id]', '--to', 'ts'])).stdout).toMatch(/^export interface Api \{/);
    expect((await ws.run(['convert', 'api.json', '--path', '$.data.items', '--to', 'ts'])).stdout).toContain('export type Items = ItemsItem[];');
    expect((await ws.run(['convert', 'api.json', '--path', '$.data.items[0]', '--to', 'ts'])).stdout).toMatch(/^export interface Api \{/);
    expect((await ws.run(['convert', 'api.json', '--path', '/data/items/1', '--to', 'ts'])).stdout).toMatch(/^export interface Api \{/);
    // Named after the file, in the singular, never after a global type: EventRecord, not the DOM's Event.
    ws.write('events.jsonl', '{"a": 1}\n{"a": 2, "b": "x"}\nnot json\n');
    const events = await ws.run(['convert', 'events.jsonl', '--to', 'ts']);
    expect(events.stdout).toBe('export interface EventRecord {\n  a: number;\n  b?: string;\n}\n');
    expect(events.stderr).toMatch(/^Note: 1 invalid line skipped \(first at line 3/);
    ws.write('users.jsonl', '{"a": 1}\n');
    expect((await ws.run(['convert', 'users.jsonl', '--to', 'ts'])).stdout).toMatch(/^export interface User \{/);
    expect((await ws.run(['convert', '-', '--jsonl', '--to', 'ts'], { stdin: '{"a": 1}\n' })).stdout).toMatch(/^export interface Item \{/);
  });

  it('never names a type after a global type, and checks --name', async () => {
    ws.write('nested.json', '{"error": {"message": "x"}, "date": {"iso": "2024"}}');
    const nested = (await ws.run(['convert', 'nested.json', '--to', 'ts'])).stdout;
    expect(nested).toContain('  error: ErrorData;');
    expect(nested).toContain('  date: DateData;');
    for (const name of ['my type', '123', 'class', 'string', 'Foo-Bar']) {
      const { code, stderr } = await ws.run(['convert', 'nested.json', '--to', 'ts', '--name', name]);
      expect([name, code]).toEqual([name, 2]);
      expect(stderr).toContain(`--name must be a TypeScript type name, like ApiResponse ("${name}" is not).`);
    }
    expect((await ws.run(['convert', 'nested.json', '--to', 'yaml', '--name', 'X'])).stderr).toContain('--name applies to --to ts and --to schema.');
  });

  it('writes JSON Schema', async () => {
    const schema = JSON.parse((await ws.run(['convert', 'api.json', '--path', '$.data.items[*]', '--to', 'json-schema', '--name', 'User'])).stdout);
    expect(schema).toMatchObject({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'User', type: 'object', required: ['id', 'name'] });
    expect(JSON.parse((await ws.run(['convert', 'user-list.json', '--to', 'schema'])).stdout).type).toBe('array');
  });

  it('writes YAML, CSV, TSV, JSON Lines and JSON with exact numbers', async () => {
    expect((await ws.run(['convert', 'user-list.json', '--to', 'yml'])).stdout).toContain('  big: 12345678901234567890\n');
    const csv = (await ws.run(['convert', 'user-list.json', '--to', 'CSV'])).stdout;
    expect(csv).toBe('id,name,address.city,big,tags\r\n1,Ada,Paris,12345678901234567890,\r\n2,\'=cmd(),,,"[""x""]"\r\n');
    expect((await ws.run(['convert', 'user-list.json', '--to', 'csv', '--delimiter', ';'])).stdout.split('\r\n')[0]).toBe('id;name;address.city;big;tags');
    expect((await ws.run(['convert', 'user-list.json', '--to', 'tsv'])).stdout.split('\r\n')[0]).toBe('id\tname\taddress.city\tbig\ttags');
    expect((await ws.run(['convert', 'user-list.json', '--to', 'ndjson'])).stdout).toBe(
      '{"id":1,"name":"Ada","address":{"city":"Paris"},"big":12345678901234567890}\n{"id":2,"name":"=cmd()","tags":["x"]}\n'
    );
    ws.write('conf.jsonc', '{\n  // c\n  "a": 1.50,\n}');
    expect((await ws.run(['convert', 'conf.jsonc', '--to', 'json'])).stdout).toBe('{\n  "a": 1.50\n}\n');
  });

  it('writes to a file, keeping a private input private', async () => {
    fs.chmodSync(ws.file('user-list.json'), 0o600);
    const { stdout } = await ws.run(['convert', 'user-list.json', '--to', 'csv', '-o', 'users.csv']);
    expect(stdout).toBe(`Wrote users.csv (${Buffer.byteLength(ws.read('users.csv'))} B).\n`);
    expect(ws.mode('users.csv')).toBe(0o600);
  });

  it('explains what cannot be converted', async () => {
    expect((await ws.run(['convert', 'api.json', '--to', 'jsonl'])).stderr).toBe('json-explorer: JSON Lines needs a list of records: select an array (e.g. --path "$.items").\n');
    expect((await ws.run(['convert', 'api.json', '--path', '$.total', '--to', 'csv'])).stderr).toContain('CSV needs an array (or a dictionary) of records');
    expect((await ws.run(['convert', 'api.json', '--path', '$.nope', '--to', 'yaml'])).stderr).toBe('json-explorer: Nothing matches $.nope in api.json.\n');
    ws.write('deep.json', `${'['.repeat(20000)}${']'.repeat(20000)}`);
    expect((await ws.run(['convert', 'deep.json', '--to', 'yaml'])).stderr).toBe('json-explorer: deep.json is nested too deeply to convert.\n');
  });

  it('checks its options', async () => {
    expect((await ws.run(['convert', 'api.json'])).stderr).toContain('--to expects one of: ts, typescript, schema, json-schema, yaml, yml, csv, tsv, jsonl, ndjson, json.');
    expect((await ws.run(['convert', 'api.json', '--to', 'xml'])).code).toBe(2);
    expect((await ws.run(['convert', 'api.json', '--to', 'tsv', '--delimiter', ';'])).stderr).toContain('--delimiter takes one character and applies to --to csv.');
    expect((await ws.run(['convert', 'api.json', '--to', 'csv', '--delimiter', ';;'])).code).toBe(2);
    expect((await ws.run(['convert', '--to', 'csv'])).stderr).toContain('Usage: json-explorer convert <file>');
  });

  it('passes other conversion failures on', async () => {
    jest.spyOn(convertUtils, 'toYaml').mockImplementation(() => {
      throw new Error('cannot express this in YAML');
    });
    expect((await ws.run(['convert', 'api.json', '--to', 'yaml'])).stderr).toBe('json-explorer: cannot express this in YAML\n');
  });
});
