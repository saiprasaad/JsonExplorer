/** @jest-environment node */
import { FAKE, withCheckDigit } from '../testing/fakeSecrets';
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
        'Values are summarized, not shown (add --samples 3 for examples, or --top 5 for the most common values).',
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
    expect(stdout).toContain('Showing examples for up to 2 values per path (none for sensitive fields).');
    expect(stdout).toContain('\n$.users[*]  object  2     2–3 keys\n');
    expect(stdout).not.toContain('$.users[*].id ');
    expect(stdout).toContain('… 1 more path (use --path');
    expect(stdout).toContain('… 4 deeper paths hidden by --depth.');
    expect((await ws.run(['outline', 'data.json', '--samples', '2'])).stdout).toMatch(/\$\.users\[\*\]\.name +string +100% +2–3 chars · all distinct · e\.g\. "Ada", "Bo"/);
  });

  it('counts the most common values on request: only repeated ones, never for sensitive fields', async () => {
    const cities = ['Paris', 'Rome', 'Paris', 'Oslo', 'Lima', 'Kyiv'];
    ws.write('langs.jsonl', ['en', 'de', 'en', 'fr', 'en', 'de'].map((lang, index) => JSON.stringify({ lang, n: index % 2, password: FAKE.password, name: `Person ${index}`, city: cities[index] })).join('\n'));
    const { stdout } = await ws.run(['outline', 'langs.jsonl', '--top', '2']);
    expect(stdout).toContain('Showing the 2 most common repeated values per path (none for sensitive fields).');
    expect(stdout).toMatch(/\$\[\*\]\.lang +string +100% +2 chars · 3 distinct · most common: "en" ×3, "de" ×2\n/);
    expect(stdout).toMatch(/\$\[\*\]\.n +integer +100% +2 distinct · most common: 0 ×3, 1 ×3\n/);
    expect(stdout).toMatch(/\$\[\*\]\.password +string +100% +1 distinct · sensitive: values hidden\n/);
    // A value seen once is not common, and would show one record: not listed.
    expect(stdout).toMatch(/\$\[\*\]\.name +string +100% +8 chars · all distinct\n/);
    expect(stdout).toMatch(/\$\[\*\]\.city +string +100% +4–5 chars · 5 distinct · most common: "Paris" ×2\n/);
    expect(stdout).not.toContain(FAKE.password);
    expect(stdout).not.toContain('Person');
    expect((await ws.run(['outline', 'langs.jsonl', '--top', '1', '--samples', '1'])).stdout).toContain('Showing examples for up to 1 value and the most common repeated value per path');
    expect((await ws.run(['outline', 'langs.jsonl', '--top', '-1'])).stderr).toContain('--top expects a whole number ≥ 0.');
  });

  it('folds maps keyed by ids or names, so their keys are never printed', async () => {
    const plans = ['free', 'pro', 'team'];
    const usersById = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`u${1001 + index}`, { plan: plans[index % 3] }]));
    const names = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi', 'ivan', 'judy', 'mallory', 'niaj', 'olivia', 'peggy', 'rupert', 'sybil', 'trent', 'uma', 'victor', 'walter'];
    const byUsername = Object.fromEntries(names.map((name, index) => [name, { plan: plans[index % 3], seats: index }]));
    ws.write('users.json', JSON.stringify({ usersById, byUsername }));
    const { stdout } = await ws.run(['outline', 'users.json']);
    expect(stdout.split('\n').slice(4).map((line) => line.split(' ')[0])).toEqual(['$', '$.usersById', '$.usersById.*', '$.usersById.*.plan', '$.byUsername', '$.byUsername.*', '$.byUsername.*.plan', '$.byUsername.*.seats', '']);
    names.forEach((name) => expect(stdout).not.toContain(name));
    // Keys that change from record to record fold too, however the records arrive.
    ws.write('scores.jsonl', names.flatMap((name) => names.slice(0, 4).map((other) => JSON.stringify({ scores: { [`${name}_${other}`]: 1 } }))).join('\n'));
    const streamed = await ws.run(['outline', 'scores.jsonl']);
    expect(streamed.stdout).toMatch(/\n\$\[\*\]\.scores\.\* +integer +80 +1 distinct\n/);
    expect(streamed.stdout).not.toContain('alice');
  });

  it('keeps secrets when outlining part of a document', async () => {
    ws.write('creds.json', JSON.stringify({ credentials: { user: 'ops-team', host: 'db.internal' }, ok: 1 }));
    const part = await ws.run(['outline', 'creds.json', '--path', '$.credentials', '--samples', '3', '--top', '3']);
    expect(part.stdout).toMatch(/\n\$\.credentials\.user +string +100% +sensitive: values hidden\n/);
    expect(part.stdout).not.toMatch(/ops-team|db\.internal/);
    ws.write('creds.jsonl', `${JSON.stringify({ credentials: { user: 'ops-team' } })}\n${JSON.stringify({ credentials: { user: 'ops-team' } })}\n`);
    const streamed = await ws.run(['outline', 'creds.jsonl', '--path', '$[*].credentials.user', '--samples', '3', '--top', '3']);
    expect(streamed.stdout).toContain('sensitive: values hidden');
    expect(streamed.stdout).not.toContain('ops-team');
  });

  it('shows true and false under sensitive names, as query does, and masks card numbers in text but not ids', async () => {
    const id = withCheckDigit(`4${'2'.repeat(17)}`);
    ws.write('flags.json', JSON.stringify({ secretRotation: true, ibanValidated: false, orders: [1, 2].map(() => ({ id, note: `paid with ${FAKE.visaCard}` })) }));
    const { stdout } = await ws.run(['outline', 'flags.json', '--samples', '2', '--top', '2']);
    expect(stdout).toMatch(/\n\$\.secretRotation +boolean +100% +1 true · 0 false\n/);
    expect(stdout).toMatch(/\n\$\.ibanValidated +boolean +100% +0 true · 1 false\n/);
    expect(stdout).toMatch(new RegExp(`\\n\\$\\.orders\\[\\*\\]\\.id +string +100% +numeric · 19 chars · 1 distinct · e\\.g\\. "${id}" · most common: "${id}" ×2\\n`));
    expect(stdout).toMatch(/\n\$\.orders\[\*\]\.note +string +100% +26 chars · 1 distinct · 2 secret-looking values hidden\n/);
    expect(stdout).not.toContain(FAKE.visaCard);
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
