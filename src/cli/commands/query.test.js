/** @jest-environment node */
import fs from 'node:fs';
import { FAKE, skKey } from '../testing/fakeSecrets';
import { makeWorkspace } from '../testing/workspace';

const DATA = JSON.stringify({
  users: [
    { id: 1, name: 'Ada', email: 'ada@example.com', apiKey: 'k-1', tags: ['a', 'b'] },
    { id: 2, name: 'Bo', email: 'bo@example.com', tags: [] },
    { id: 3, name: 'Cy', note: skKey('live-0123456789abcdefghijklmn') },
  ],
  big: 'BIG',
});
const DATA_TEXT = DATA.replace('"BIG"', '12345678901234567890');
const EVENTS = ['{"level":"info","n":1}', '', '{"level":"error","n":2,"msg":"disk full"}', 'oops', '{"level":"error","n":3.50,"msg":"timeout"}', '{"level":"info","n":4}'].join('\n');

let ws;
beforeEach(() => {
  ws = makeWorkspace({ 'data.json': DATA_TEXT, 'events.jsonl': EVENTS });
});
afterEach(() => ws.cleanup());

describe('query', () => {
  it('prints only totals or paths as JSON when asked, and checks --max-chars', async () => {
    ws.write('list.json', '{"items": [{"id": 1}, {"id": 2}]}');
    expect(JSON.parse((await ws.run(['query', 'list.json', '$.items[*].id', '--json', '--count'])).stdout)).toEqual([{ query: '$.items[*].id', total: 2 }]);
    expect(JSON.parse((await ws.run(['query', 'list.json', '$.items[*].id', '--json', '--paths'])).stdout)).toEqual([{ query: '$.items[*].id', total: 2, matches: [{ path: '$.items[0].id' }, { path: '$.items[1].id' }] }]);
    expect((await ws.run(['query', 'list.json', '$', '--max-chars', '-1'])).stderr).toContain('--max-chars expects a whole number ≥ 0.');
  });

  it('prints each match with its path', async () => {
    expect(await ws.run(['query', 'data.json', '$.users[*].name'])).toEqual({
      code: 0,
      stdout: '$.users[0].name: "Ada"\n$.users[1].name: "Bo"\n$.users[2].name: "Cy"\n',
      stderr: '',
    });
  });

  it('keeps numbers exactly as written', async () => {
    expect((await ws.run(['query', 'data.json', '$.big'])).stdout).toBe('$.big: 12345678901234567890\n');
  });

  it('pretty-prints structured values, indenting continuation lines', async () => {
    expect((await ws.run(['query', 'data.json', '$.users[0].tags'])).stdout).toBe('$.users[0].tags: [\n    "a",\n    "b"\n  ]\n');
    expect((await ws.run(['query', 'data.json', '$.users[0].tags', '--compact'])).stdout).toBe('$.users[0].tags: ["a","b"]\n');
  });

  it('answers several queries in sections', async () => {
    expect((await ws.run(['query', 'data.json', '$.users[0].id', '$.nothing', '$.users[1].id'])).stdout).toBe(
      '$.users[0].id:\n$.users[0].id: 1\n\n$.nothing:\nNo matches for $.nothing.\n\n$.users[1].id:\n$.users[1].id: 2\n'
    );
  });

  it('prints counts, paths, values or raw strings', async () => {
    expect((await ws.run(['query', 'data.json', '$..id', '--count'])).stdout).toBe('3\n');
    expect((await ws.run(['query', 'data.json', '$..id', '$..name', '--count'])).stdout).toBe('$..id:\n3\n\n$..name:\n3\n');
    expect((await ws.run(['query', 'data.json', '$..email', '--paths'])).stdout).toBe('$.users[0].email\n$.users[1].email\n');
    expect((await ws.run(['query', 'data.json', '$..email', '--values'])).stdout).toBe('"ada@example.com"\n"bo@example.com"\n');
    expect((await ws.run(['query', 'data.json', '$.users[0]["name","id"]', '--raw'])).stdout).toBe('Ada\n1\n');
  });

  it('says when nothing matches', async () => {
    expect(await ws.run(['query', 'data.json', '$.missing'])).toEqual({ code: 0, stdout: 'No matches for $.missing.\n', stderr: '' });
  });

  it('exits 1 when a query matches nothing, if asked', async () => {
    expect((await ws.run(['query', 'data.json', '$.nothing'])).code).toBe(0);
    expect((await ws.run(['query', 'data.json', '$.nothing', '--exit-status'])).code).toBe(1);
    expect((await ws.run(['query', 'data.json', '$.big', '$.nothing', '--exit-status', '--count'])).code).toBe(1);
    expect((await ws.run(['query', 'data.json', '$.big', '--exit-status'])).code).toBe(0);
  });

  it('limits the matches shown', async () => {
    expect((await ws.run(['query', 'data.json', '$..id', '--limit', '1'])).stdout).toBe('$.users[0].id: 1\n… 2 more matches (use --limit <n>, or --limit 0 for all).\n');
    expect((await ws.run(['query', 'data.json', '$..id', '--limit', '2'])).stdout).toContain('… 1 more match (');
    expect((await ws.run(['query', 'data.json', '$..id', '--limit', '0'])).stdout.split('\n')).toHaveLength(4);
    expect((await ws.run(['query', 'data.json', '$..id', '--limit', '-1'])).stderr).toContain('--limit expects a whole number ≥ 0.');
    expect((await ws.run(['query', 'data.json', '$..id', '--limit', '1.5'])).code).toBe(2);
  });

  it('truncates very long values', async () => {
    const { stdout } = await ws.run(['query', 'data.json', '$.users[0]', '--compact', '--max-chars', '10']);
    expect(stdout).toBe('$.users[0]: {"id":1,"n… (truncated at 10 characters; use --max-chars 0 or -o <file> for everything)\n');
    expect((await ws.run(['query', 'data.json', '$.users[0]', '--compact', '--max-chars', '0'])).stdout).not.toContain('truncated');
  });

  it('masks secrets unless asked to show them', async () => {
    const masked = await ws.run(['query', 'data.json', '$.users[*]["apiKey","note"]']);
    expect(masked.stdout).toBe('$.users[0].apiKey: "[REDACTED]"\n$.users[2].note: "[REDACTED]"\n');
    expect(masked.stderr).toBe('2 values hidden because they look like secrets; add --show-secrets to reveal them.\n');
    const one = await ws.run(['query', 'data.json', '$.users[0].apiKey']);
    expect(one.stderr).toBe('1 value hidden because it looks like a secret; add --show-secrets to reveal it.\n');
    const shown = await ws.run(['query', 'data.json', '$.users[0].apiKey', '--show-secrets']);
    expect(shown).toEqual({ code: 0, stdout: '$.users[0].apiKey: "k-1"\n', stderr: '' });
  });

  it('lets filters read masked values only when asked, so a filter cannot confirm a guess', async () => {
    const hidden = FAKE.password;
    ws.write('sec.json', JSON.stringify({ user: { name: 'ada', password: hidden } }));
    ws.write('sec.jsonl', `${JSON.stringify({ user: 'ada', password: hidden })}\n${JSON.stringify({ user: 'bo' })}\n`);
    const count = async (file, expression, ...flags) => (await ws.run(['query', file, expression, '--count', ...flags])).stdout;
    expect(await count('sec.json', `$.user[?@ == "${hidden}"]`)).toBe('0\n');
    // Masked values read as absent: a right and a wrong guess give the same answer.
    expect(await count('sec.json', `$.user[?@ != "${hidden}"]`)).toBe('2\n');
    expect(await count('sec.json', '$.user[?@ != "wrong"]')).toBe('2\n');
    expect(await count('sec.json', `$.user[?match(@, "${hidden.slice(0, 3)}.*")]`)).toBe('0\n');
    expect(await count('sec.json', `$.user[?length(@) == ${hidden.length}]`)).toBe('0\n');
    expect(await count('sec.json', '$.user[?@ == "ada"]')).toBe('1\n');
    expect(await count('sec.json', `$.user[?@ == "${hidden}"]`, '--show-secrets')).toBe('1\n');
    expect(await count('sec.jsonl', `$[?@.password == "${hidden}"]`)).toBe('0\n');
    expect(await count('sec.jsonl', `$[?@.password == "${hidden}"]`, '--show-secrets')).toBe('1\n');
  });

  it('prints JSON', async () => {
    const { stdout } = await ws.run(['query', 'data.json', '$.users[0].apiKey', '$.big', '--json']);
    expect(stdout).toBe(
      `${JSON.stringify(
        [
          { query: '$.users[0].apiKey', total: 1, matches: [{ path: '$.users[0].apiKey', value: '[REDACTED]' }] },
          { query: '$.big', total: 1, matches: [{ path: '$.big', value: 0 }] },
        ],
        null,
        2
      ).replace('"value": 0', '"value": 12345678901234567890')}\n`
    );
  });

  it('accepts JSON Pointers', async () => {
    expect((await ws.run(['query', 'data.json', '/users/1/name'])).stdout).toBe('$.users[1].name: "Bo"\n');
  });

  it('writes a match, or a list of matches, to a file', async () => {
    fs.chmodSync(ws.file('data.json'), 0o600);
    expect(await ws.run(['query', 'data.json', '$.users[0].tags', '-o', 'tags.json'])).toEqual({ code: 0, stdout: 'Wrote 1 match for $.users[0].tags to tags.json.\n', stderr: '' });
    expect(ws.read('tags.json')).toBe('[\n  "a",\n  "b"\n]\n');
    expect(ws.mode('tags.json')).toBe(0o600);
    await ws.run(['query', 'data.json', '$.big', '-o', 'big.json']);
    expect(ws.read('big.json')).toBe('12345678901234567890\n');
    expect((await ws.run(['query', 'data.json', '$..apiKey', '-o', 'keys.json'])).stdout).toBe('Wrote 1 match for $..apiKey to keys.json.\n');
    expect(ws.read('keys.json')).toBe('[\n  "k-1"\n]\n');
    expect((await ws.run(['query', 'data.json', '$..id', '--limit', '1', '-o', 'ids.json'])).stdout).toBe('Wrote 3 matches for $..id to ids.json.\n');
  });

  it('refuses to write nothing, or several queries, to a file', async () => {
    const none = await ws.run(['query', 'data.json', '$.missing', '-o', 'x.json']);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('Nothing matches $.missing; no file written.');
    expect(ws.exists('x.json')).toBe(false);
    expect((await ws.run(['query', 'data.json', '$.a', '$.b', '-o', 'x.json'])).stderr).toContain('-o writes one query result; give a single path.');
  });

  it('needs a file and a path', async () => {
    expect((await ws.run(['query', 'data.json'])).stderr).toContain('Usage: json-explorer query <file> <path>...');
  });

  describe('JSON Lines', () => {
    it('streams record-wise queries, skipping blank and invalid lines', async () => {
      expect(await ws.run(['query', 'events.jsonl', '$[?@.level == "error"].msg'])).toEqual({
        code: 0,
        stdout: '$[1].msg: "disk full"\n$[2].msg: "timeout"\n',
        stderr: 'Note: 1 invalid line skipped (first at line 4, column 1: Unexpected text — strings must be in double quotes).\n',
      });
      expect((await ws.run(['query', 'events.jsonl', '$[*].n', '--limit', '2'])).stdout).toBe('$[0].n: 1\n$[1].n: 2\n… 2 more matches (use --limit <n>, or --limit 0 for all).\n');
      expect((await ws.run(['query', 'events.jsonl', '$[*].n', '$[1:3].level', '--count'])).stdout).toBe('$[*].n:\n4\n\n$[1:3].level:\n2\n');
      expect((await ws.run(['query', 'events.jsonl', '$[*].n', '--limit', '0', '--values'])).stdout).toBe('1\n2\n3.50\n4\n');
    });

    it('stops reading once no query can match further records', async () => {
      const { stdout, stderr } = await ws.run(['query', 'events.jsonl', '$[0]', '$[1].n', '--compact']);
      expect(stdout).toBe('$[0]:\n$[0]: {"level":"info","n":1}\n\n$[1].n:\n$[1].n: 2\n');
      expect(stderr).toBe('');
    });

    it('loads the whole file for other queries', async () => {
      const { stdout, stderr } = await ws.run(['query', 'events.jsonl', '$[-1].n']);
      expect(stdout).toBe('$[3].n: 4\n');
      expect(stderr).toMatch(/^Note: 1 invalid line skipped/);
      expect((await ws.run(['query', 'events.jsonl', '/2/msg'])).stdout).toBe('$[2].msg: "timeout"\n');
      expect((await ws.run(['query', 'events.jsonl', '$[?@.level == "info"]', '-o', 'info.json'])).stdout).toBe('Wrote 2 matches for $[?@.level == "info"] to info.json.\n');
    });

    it('reads records from stdin', async () => {
      expect((await ws.run(['query', '-', '$[*].a', '--jsonl'], { stdin: '{"a":1}\n{"a":2}\n' })).stdout).toBe('$[0].a: 1\n$[1].a: 2\n');
    });
  });
});
