/** @jest-environment node */
import { FAKE } from '../testing/fakeSecrets';
import { makeWorkspace } from '../testing/workspace';

const DATA = `{"users": [{"id": 1, "name": "Ada", "password": "${FAKE.password}"}, {"id": 2, "name": "Bo"}], "meta": {"x": {"y": 1}}}`;
const EVENTS = '{"level": "info", "ms": 5}\n\n{"level": "error", "ms": 50, "user": {"id": 7}}\nnot json\n{"level": "info", "ms": 9}\n';
const DATA_SIZE = `${Buffer.byteLength(DATA)} B`;

let ws;
beforeEach(() => {
  ws = makeWorkspace({ 'data.json': DATA, 'events.jsonl': EVENTS });
});
afterEach(() => ws.cleanup());

describe('outline', () => {
  it('maps a document without showing values', async () => {
    const { code, stdout, stderr } = await ws.run(['outline', 'data.json']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toBe(
      [
        `data.json · JSON · ${DATA_SIZE} · 12 values · depth 3`,
        'Values are summarized, not shown (add --samples 3 for examples).',
        '',
        'PATH                 TYPE     SEEN     DETAILS',
        '$                    object   1        2 keys',
        '$.users              array    100%     2 items',
        '$.users[*]           object   2        2–3 keys',
        '$.users[*].id        integer  100%     all distinct',
        '$.users[*].name      string   100%     2–3 chars · all distinct',
        '$.users[*].password  string   50% (1)  sensitive: values hidden',
        '$.meta               object   100%     1 key',
        '$.meta.x             object   100%     1 key',
        '$.meta.x.y           integer  100%',
        '',
      ].join('\n')
    );
    expect(stdout).not.toContain(FAKE.password);
  });

  it('shows samples, limits depth and rows', async () => {
    const { stdout } = await ws.run(['outline', 'data.json', '--samples', '2', '--depth', '2', '--max-paths', '4']);
    expect(stdout).toContain('Examples shown for up to 2 values per path (none for sensitive fields).');
    expect(stdout).toContain('\n$.users[*]  object  2     2–3 keys\n');
    expect(stdout).not.toContain('$.users[*].id ');
    expect(stdout).toContain('… 1 more path (use --path');
    expect(stdout).toContain('… 4 deeper paths hidden by --depth.');
    expect((await ws.run(['outline', 'data.json', '--samples', '2'])).stdout).toMatch(/\$\.users\[\*\]\.name +string +100% +2–3 chars · all distinct · e\.g\. "Ada", "Bo"/);
  });

  it.each([
    ['--samples', '-1'],
    ['--depth', '1.5'],
    ['--max-paths', '-2'],
    ['--records', '0.5'],
  ])('rejects %s %s', async (flag, value) => {
    const { code, stderr } = await ws.run(['outline', 'data.json', flag, value]);
    expect(code).toBe(2);
    expect(stderr).toContain(`${flag} expects a whole number ≥ 0.`);
  });

  it('outlines what a path selects', async () => {
    const one = await ws.run(['outline', 'data.json', '--path', '$.users[0]']);
    expect(one.stdout).toContain('Note: outline of $.users[0].');
    expect(one.stdout).toMatch(/\n\$\.users\[0\]\.name +string/);
    const many = await ws.run(['outline', 'data.json', '--path', '$.users[*]']);
    expect(many.stdout).toContain('Note: outline of 2 matches for $.users[*].');
    expect(many.stdout).toMatch(/\n\$\.users\[\*\]\.id +integer +100%/);
    expect(await ws.run(['outline', 'data.json', '--path', '$.nothing'])).toEqual({ code: 1, stdout: `data.json · JSON · ${DATA_SIZE}\nNothing matches $.nothing.\n`, stderr: '' });
    // A filter never reads a secret, so it cannot confirm one.
    expect(await ws.run(['outline', 'data.json', '--path', `$.users[?@.password == "${FAKE.password}"]`])).toMatchObject({ code: 1, stdout: expect.stringContaining('Nothing matches') });
    expect((await ws.run(['outline', 'data.json', '--path', '$.users[?@.name == "Ada"]'])).code).toBe(0);
  });

  it('prints JSON', async () => {
    const { code, stdout } = await ws.run(['outline', 'data.json', '--json']);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({ heading: `data.json · JSON · ${DATA_SIZE}`, notes: [], values: 12, maxDepth: 3 });
    expect(result.paths.map((item) => item.path)).toContain('$.users[*].password');
  });

  it('streams JSON Lines, skipping blank and invalid lines', async () => {
    const { code, stdout } = await ws.run(['outline', 'events.jsonl']);
    expect(code).toBe(0);
    expect(stdout).toContain(`events.jsonl · JSON Lines · ${Buffer.byteLength(EVENTS)} B · 3 records · 12 values · depth 3`);
    expect(stdout).toContain('Note: 1 invalid line skipped (first at line 4, column 1: ');
    expect(stdout).toMatch(/\n\$ +array +1 +3 items\n\$\[\*\] +object +3 +2–3 keys\n\$\[\*\]\.level +string +100% +4–5 chars · 2 distinct/);
    expect(stdout).toMatch(/\n\$\[\*\]\.user +object +33% \(1\) +1 key/);
  });

  it('can stop after some records', async () => {
    const { stdout } = await ws.run(['outline', 'events.jsonl', '--records', '1', '--json']);
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({ records: 1, invalidLines: 0, truncated: true, notes: ['only the first 1 record analyzed (--records)'] });
  });

  it('applies a path to the list of records, as query does', async () => {
    const streamed = await ws.run(['outline', 'events.jsonl', '--path', '$[*].user']);
    expect(streamed.code).toBe(0);
    expect(streamed.stdout).toContain('Note: outline of 1 match for $[*].user.');
    expect(streamed.stdout).toMatch(/\n\$\[\*\]\.user +object +1 +1 key\n\$\[\*\]\.user\.id +integer/);
    const levels = await ws.run(['outline', 'events.jsonl', '--path', '$[*].level', '--records', '2']);
    expect(levels.stdout).toMatch(/\n\$\[\*\]\.level +string +2 +4–5 chars/);
    // Paths that need every record at once (the last one, a JSON Pointer) read the whole file.
    const last = await ws.run(['outline', 'events.jsonl', '--path', '$[-1]']);
    expect(last.stdout).toMatch(/Note: outline of \$\[2\]\./);
    const pointer = await ws.run(['outline', 'events.jsonl', '--path', '/1/user', '--records', '1']);
    expect(pointer.stdout).toContain('Note: only the first 1 record analyzed (--records).');
    expect(pointer.stdout).toContain('Nothing matches /1/user.');
    expect(pointer.code).toBe(1);
    const none = await ws.run(['outline', 'events.jsonl', '--path', '$.user']);
    expect(none).toMatchObject({ code: 1, stdout: expect.stringContaining('Nothing matches $.user.') });
    expect((await ws.run(['outline', 'data.json', '--records', '1'])).stderr).toContain('--records applies to JSON Lines files only.');
  });

  it('reads JSON Lines from stdin', async () => {
    const { stdout } = await ws.run(['outline', '-', '--jsonl'], { stdin: '{"a":1}\n{"a":2}\n' });
    expect(stdout.split('\n')[0]).toBe('stdin · JSON Lines · 2 records · 5 values · depth 2');
  });

  it('needs exactly one file', async () => {
    expect((await ws.run(['outline'])).stderr).toContain('Usage: json-explorer outline <file>');
    expect((await ws.run(['outline', 'a', 'b'])).code).toBe(2);
  });
});
