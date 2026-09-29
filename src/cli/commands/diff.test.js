/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import { makeWorkspace, pagePayload } from '../testing/workspace';
import { VERSION } from '../version';

const BEFORE = '{"id": 12345678901234567890, "price": 1.50, "tags": ["a", "b"], "items": [{"id": 1, "q": 1}, {"id": 2, "q": 1}], "meta": {"updatedAt": "2024-01-01"}, "token": "old", "kind": 1}';
const AFTER = '{"items": [{"id": 3, "q": 9}, {"id": 1, "q": 2}, {"id": 2, "q": 1}], "price": 1.5, "tags": ["a", "c"], "id": 12345678901234567891, "meta": {"updatedAt": "2024-02-02"}, "token": "new", "kind": "one"}';

let ws;
beforeEach(() => {
  ws = makeWorkspace({ 'before.json': BEFORE, 'after.json': AFTER, 'copy.json': BEFORE.replace('1.50', '1.500') });
});
afterEach(() => ws.cleanup());

describe('diff', () => {
  it('lists the differences by path and exits 1', async () => {
    const { code, stdout, stderr } = await ws.run(['diff', 'before.json', 'after.json']);
    expect(code).toBe(1);
    expect(stdout).toBe(
      [
        'before.json → after.json: 7 differences (1 added, 0 removed, 6 changed)',
        '',
        '~ $.id: 12345678901234567890 → 12345678901234567891',
        '~ $.tags[1]: "b" → "c"',
        '+ $.items[0]: {"id":3,"q":9}',
        '~ $.items[1].q: 1 → 2 (was $.items[0].q)',
        '~ $.meta.updatedAt: "2024-01-01" → "2024-02-02"',
        '~ $.token: "[REDACTED]" → "[REDACTED]"',
        '~ $.kind: 1 → "one" (type changed)',
        '',
      ].join('\n')
    );
    expect(stderr).toBe('2 values hidden because they look like secrets; add --show-secrets to reveal them.\n');
  });

  it('reports identical data (by value, not text) and exits 0', async () => {
    expect(await ws.run(['diff', 'before.json', 'copy.json'])).toEqual({ code: 0, stdout: 'No differences: before.json and copy.json contain the same data.\n', stderr: '' });
  });

  it('ignores paths', async () => {
    const { stdout } = await ws.run(['diff', 'before.json', 'after.json', '--ignore', '$..updatedAt', '--ignore', '$.items', '--ignore', '$.token', '--ignore', '$.tags[1]']);
    expect(stdout).toBe('before.json → after.json: 2 differences (0 added, 0 removed, 2 changed)\n\n~ $.id: 12345678901234567890 → 12345678901234567891\n~ $.kind: 1 → "one" (type changed)\n');
    expect(await ws.run(['diff', 'before.json', 'after.json', '--ignore', '$'])).toEqual({
      code: 0,
      stdout: 'No differences: before.json and after.json contain the same data (outside the ignored paths).\n',
      stderr: '',
    });
    const invalid = await ws.run(['diff', 'before.json', 'after.json', '--ignore', '$[']);
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toMatch(/^json-explorer: Invalid JSONPath/);
  });

  it('can compare arrays position by position', async () => {
    const { stdout } = await ws.run(['diff', 'before.json', 'after.json', '--array-match', 'index', '--ignore', '$.meta', '--ignore', '$.token', '--ignore', '$.kind', '--ignore', '$.id', '--ignore', '$.tags']);
    expect(stdout).toBe(
      'before.json → after.json: 5 differences (1 added, 0 removed, 4 changed)\n\n~ $.items[0].id: 1 → 3\n~ $.items[0].q: 1 → 9\n~ $.items[1].id: 2 → 1\n~ $.items[1].q: 1 → 2\n+ $.items[2]: {"id":2,"q":1}\n'
    );
    expect((await ws.run(['diff', 'before.json', 'after.json', '--array-match', 'fuzzy'])).stderr).toContain('--array-match expects "align", "unordered" or "index".');
  });

  it('reports items that moved, unless the order does not matter', async () => {
    ws.write('old.json', '[{"id": 1, "q": 1}, {"id": 2, "q": 1}, {"id": 3, "q": 1}]');
    ws.write('new.json', '[{"id": 2, "q": 1}, {"id": 3, "q": 1}, {"id": 1, "q": 4}]');
    const { code, stdout } = await ws.run(['diff', 'old.json', 'new.json']);
    expect(code).toBe(1);
    expect(stdout).toBe('old.json → new.json: 2 differences (0 added, 0 removed, 1 changed, 1 moved)\n\n↕ $[2]: {"id":1,"q":4} (moved from $[0])\n~ $[2].q: 1 → 4 (was $[0].q)\n');
    const json = JSON.parse((await ws.run(['diff', 'old.json', 'new.json', '--json'])).stdout);
    expect(json.counts).toEqual({ added: 0, removed: 0, changed: 1, moved: 1 });
    expect(json.changes[0]).toEqual({ kind: 'moved', path: '$[2]', leftPath: '$[0]', before: { id: 1, q: 1 }, after: { id: 1, q: 4 } });
    expect((await ws.run(['diff', 'old.json', 'new.json', '--array-match', 'unordered'])).stdout).toBe(
      'old.json → new.json: 1 difference (0 added, 0 removed, 1 changed)\n\n~ $[2].q: 1 → 4 (was $[0].q)\n'
    );
    ws.write('reversed.json', '["c", "b", "a"]');
    ws.write('letters.json', '["a", "b", "c"]');
    expect((await ws.run(['diff', 'letters.json', 'reversed.json'])).stdout).toBe(
      'letters.json → reversed.json: 2 differences (0 added, 0 removed, 0 changed, 2 moved)\n\n↕ $[1]: "b" (order changed)\n↕ $[2]: "a" (moved from $[0])\n'
    );
    ws.write('same.json', '[{"id": 3, "q": 1}, {"id": 1, "q": 1}, {"id": 2, "q": 1}]');
    expect(await ws.run(['diff', 'old.json', 'same.json', '--array-match', 'unordered'])).toEqual({ code: 0, stdout: 'No differences: old.json and same.json contain the same data.\n', stderr: '' });
  });

  it('limits the list', async () => {
    const { stdout } = await ws.run(['diff', 'before.json', 'after.json', '--limit', '2', '--show-secrets']);
    expect(stdout.split('\n').slice(2)).toEqual([
      '~ $.id: 12345678901234567890 → 12345678901234567891',
      '~ $.tags[1]: "b" → "c"',
      '… 5 more differences (use --limit <n>, --limit 0 for all, or --html for a visual report).',
      '',
    ]);
    expect((await ws.run(['diff', 'before.json', 'after.json', '--limit', '0'])).stdout).not.toContain('more difference');
    expect((await ws.run(['diff', 'before.json', 'after.json', '--limit', '-3'])).stderr).toContain('--limit expects a whole number ≥ 0.');
  });

  it('shows secrets when asked', async () => {
    const { stdout, stderr } = await ws.run(['diff', 'before.json', 'after.json', '--show-secrets']);
    expect(stdout).toContain('~ $.token: "old" → "new"');
    expect(stderr).toBe('');
    const json = JSON.parse((await ws.run(['diff', 'before.json', 'after.json', '--show-secrets', '--json', '--limit', '0'])).stdout);
    expect(json.changes.find((change) => change.path === '$.token')).toEqual({ kind: 'changed', path: '$.token', before: 'old', after: 'new' });
  });

  it('lists removed values', async () => {
    ws.write('less.json', '{"a": 1}');
    expect((await ws.run(['diff', 'before.json', 'less.json', '--ignore', '$.meta'])).stdout).toContain('\n- $.id: 12345678901234567890\n');
  });

  it('prints JSON', async () => {
    const { code, stdout } = await ws.run(['diff', 'before.json', 'after.json', '--json', '--limit', '3']);
    expect(code).toBe(1);
    expect(stdout).toBe(
      `${JSON.stringify(
        {
          total: 7,
          counts: { added: 1, removed: 0, changed: 6, moved: 0 },
          changes: [
            { kind: 'changed', path: '$.id', before: 'X', after: 'Y' },
            { kind: 'changed', path: '$.tags[1]', before: 'b', after: 'c' },
            { kind: 'added', path: '$.items[0]', after: { id: 3, q: 9 } },
          ],
          truncated: true,
        },
        null,
        2
      )
        .replace('"X"', '12345678901234567890')
        .replace('"Y"', '12345678901234567891')}\n`
    );
    const all = JSON.parse((await ws.run(['diff', 'before.json', 'after.json', '--json', '--limit', '0'])).stdout);
    expect(all.truncated).toBe(false);
    expect(all.changes.find((change) => change.path === '$.kind')).toEqual({ kind: 'changed', path: '$.kind', before: 1, after: 'one', typeChanged: true });
    expect(all.changes.find((change) => change.path === '$.token')).toMatchObject({ before: '[REDACTED]', after: '[REDACTED]' });
    ws.write('less.json', '{"a": 1, "b": 2}');
    ws.write('more.json', '{"a": 1}');
    expect(JSON.parse((await ws.run(['diff', 'less.json', 'more.json', '--json'])).stdout).changes).toEqual([{ kind: 'removed', path: '$.b', before: 2 }]);
  });

  it('writes a visual report', async () => {
    const { code, stdout } = await ws.run(['diff', 'before.json', 'after.json', '--html', '-', '--ignore', '$.meta']);
    expect(code).toBe(1);
    const file = ws.pageFile('after.');
    expect(path.basename(file)).toMatch(/^after\.[0-9a-f]{8}\.diff\.html$/);
    expect(stdout).toMatch(new RegExp(`^Wrote ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(.*, readable only by you\\)\\.\\nOpen it in any web browser: file://`));
    const html = fs.readFileSync(file, 'utf8');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(html).toContain('<title>before.json → after.json · JSON Explorer</title>');
    expect(pagePayload(html)).toEqual({
      kind: 'diff',
      left: { name: 'before.json', text: BEFORE },
      right: { name: 'after.json', text: AFTER },
      ignore: ['$.meta'],
      arrays: 'align',
      generator: `JSON Explorer ${VERSION}`,
    });
    ws.write('reports/.keep', '');
    await ws.run(['diff', 'before.json', 'after.json', '--html', 'reports/r.html', '--array-match', 'index']);
    expect(pagePayload(ws.read('reports/r.html'))).toMatchObject({ ignore: [], arrays: 'index' });
  });

  it('reads one side from stdin', async () => {
    expect((await ws.run(['diff', '-', 'copy.json'], { stdin: BEFORE })).stdout).toBe('No differences: stdin and copy.json contain the same data.\n');
    await ws.run(['diff', 'before.json', '-', '--html', 'r.html'], { stdin: AFTER });
    expect(pagePayload(ws.read('r.html')).right.name).toBe('stdin');
    await ws.run(['diff', '-', 'after.json', '--html', 'l.html'], { stdin: BEFORE });
    expect(pagePayload(ws.read('l.html')).left.name).toBe('stdin');
    expect((await ws.run(['diff', '-', '-'])).stderr).toContain('Only one side of a diff can be read from stdin.');
  });

  it('compares JSON Lines as lists of records', async () => {
    ws.write('a.jsonl', '{"n":1}\n{"n":2}\n');
    ws.write('b.jsonl', '{"n":1}\n{"n":3}\n');
    expect((await ws.run(['diff', 'a.jsonl', 'b.jsonl'])).stdout).toContain('~ $[1].n: 2 → 3');
  });

  it('needs two files', async () => {
    expect((await ws.run(['diff', 'before.json'])).stderr).toContain('Usage: json-explorer diff <before> <after>');
  });
});
