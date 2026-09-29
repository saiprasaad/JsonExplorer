/** @jest-environment node */
import { RawNumber } from '../utils/json';
import { memberPath, OutlineBuilder, renderOutline as outlineTable } from './outline';
import { FAKE, skKey } from './testing/fakeSecrets';

function outlineOf(value, options) {
  const builder = new OutlineBuilder(options);
  builder.add(value);
  return builder.result();
}

const row = (result, path) => result.paths.find((item) => item.path === path);

describe('memberPath', () => {
  it('uses dot notation for plain names and brackets otherwise', () => {
    expect(memberPath('$', 'name_1')).toBe('$.name_1');
    expect(memberPath('$', 'first name')).toBe('$["first name"]');
    expect(memberPath('$', '1st')).toBe('$["1st"]');
    expect(memberPath('$', 'a"b')).toBe('$["a\\"b"]');
  });
});

describe('OutlineBuilder', () => {
  it('folds array items and counts presence per record', () => {
    const result = outlineOf({ users: [{ id: 1, email: 'a@x.io' }, { id: 2 }, { id: 3, email: null }] });
    expect(result.paths.map((item) => item.path)).toEqual(['$', '$.users', '$.users[*]', '$.users[*].id', '$.users[*].email']);
    expect(row(result, '$.users[*].email')).toMatchObject({ count: 2, presence: 2 / 3, types: [{ type: 'string', count: 1 }, { type: 'null', count: 1 }] });
    expect(row(result, '$.users[*]')).toMatchObject({ count: 3, presence: null, keys: { min: 1, max: 2 } });
    expect(row(result, '$.users')).toMatchObject({ items: { min: 3, max: 3 }, presence: 1, depth: 1 });
    expect(result).toMatchObject({ values: 10, maxDepth: 3, roots: 1 });
    expect(result.totals).toEqual({ object: 4, array: 1, string: 1, integer: 3, number: 0, boolean: 0, null: 1 });
  });

  it('reports "number" rather than "integer|number" when whole and fractional numbers mix', () => {
    const result = outlineOf([1, 2.5, new RawNumber('1840.00'), 7, 12]);
    expect(row(result, '$[*]')).toMatchObject({ types: [{ type: 'number', count: 5 }], numbers: { min: '1', max: '1840.00' } });
    expect(row(outlineOf([1, 2]), '$[*]').types).toEqual([{ type: 'integer', count: 2 }]);
  });

  it('keeps exact number literals in ranges', () => {
    const result = outlineOf([new RawNumber('12345678901234567890'), new RawNumber('12345678901234567891'), new RawNumber('0.10'), 5, 6]);
    expect(row(result, '$[*]').numbers).toEqual({ min: '0.10', max: '12345678901234567891' });
  });

  it('measures strings in characters and detects formats', () => {
    const values = ['2024-05-01T10:00:00Z', '2024-05-01', '10:30', 'a@b.co', 'https://x.io/a', '123e4567-e89b-12d3-a456-426614174000', '192.168.0.1', '-12.5', '#ffcc00', '😀x'];
    const result = outlineOf(Object.fromEntries(values.map((value, index) => [`k${index}`, value])));
    expect(values.map((_, index) => row(result, `$.k${index}`).format)).toEqual(['date-time', 'date', 'time', 'email', 'uri', 'uuid', 'ipv4', 'numeric', 'hex-color', null]);
    expect(row(result, '$.k9').length).toEqual({ min: 2, max: 2 });
  });

  it('counts characters, not UTF-16 units, even around lone surrogates', () => {
    expect(row(outlineOf(['\uD83D\uDE00', '\uDC00x', 'a\uDC00', '\uD800']), '$[*]').length).toEqual({ min: 1, max: 2 });
  });

  it('names a format only when nearly all strings share it', () => {
    const emails = Array.from({ length: 9 }, (_, index) => `u${index}@x.io`);
    expect(row(outlineOf([...emails, 'not an email']), '$[*]').format).toBe('email');
    expect(row(outlineOf([...emails.slice(0, 5), 'a', 'b']), '$[*]').format).toBeNull();
  });

  it('folds maps with many or id-like keys into .*', () => {
    const many = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key${index}`, index]));
    expect(outlineOf(many).paths.map((item) => item.path)).toEqual(['$', '$.*']);
    const ids = { 101: {}, 102: {}, 103: {}, 104: {}, 105: { name: 'x' } };
    expect(outlineOf(ids).paths.map((item) => item.path)).toEqual(['$', '$.*', '$.*.name']);
    expect(row(outlineOf(ids), '$.*')).toMatchObject({ count: 5, presence: null });
    const dated = { '2024-01-01': 1, '2024-01-02': 2, '2024-01-03': 3, '2024-01-04': 4, '2024-01-05': 5 };
    expect(outlineOf(dated).paths).toHaveLength(2);
    const few = { 1: 'a', 2: 'b', 3: 'c', 4: 'd' };
    expect(outlineOf(few).paths).toHaveLength(5);
    const mixed = { a1: 1, b2: 2, 101: 3, 102: 4, 103: 5 };
    expect(outlineOf(mixed).paths).toHaveLength(6);
  });

  it('counts distinct values, up to a limit', () => {
    expect(row(outlineOf(['a', 'b', 'a', 1, '1']), '$[*]').distinct).toBe(4);
    expect(row(outlineOf(Array.from({ length: 1500 }, (_, index) => index)), '$[*]').distinct).toBe('1000+');
    expect(row(outlineOf([true, false]), '$[*]').distinct).toBeNull();
  });

  it('counts booleans', () => {
    expect(row(outlineOf([true, true, false]), '$[*]').booleans).toEqual({ true: 2, false: 1 });
    expect(row(outlineOf([1]), '$[*]').booleans).toBeNull();
  });

  it('collects distinct samples on request, never from sensitive fields or secret-looking values', () => {
    const long = 'x'.repeat(80);
    const records = [
      { name: 'Ada', password: FAKE.password, note: skKey('live-0123456789abcdefghijklmn'), long, n: 1 },
      { name: 'Ada', password: `${FAKE.password}-2`, note: 'hello', long, n: 2 },
      { name: 'Bo', password: 'x', note: 'hi', long, n: 3 },
    ];
    const result = outlineOf(records, { samples: 2 });
    expect(row(result, '$[*].name').samples).toEqual(['"Ada"', '"Bo"']);
    expect(row(result, '$[*].password').samples).toEqual([]);
    expect(row(result, '$[*].note')).toMatchObject({ samples: ['"hello"', '"hi"'], secretValues: 1 });
    expect(row(result, '$[*].long').samples).toEqual([`"${'x'.repeat(59)}…"`]);
    expect(row(result, '$[*].n').samples).toEqual(['1', '2']);
    expect(row(outlineOf(records), '$[*].name').samples).toEqual([]);
  });

  it('hides lengths and ranges of sensitive fields, and ranges that would reveal individual values', () => {
    const records = [1234, 99, 5, 41, 7].map((pin, index) => ({ pin, token: 'abc'.repeat(index + 1), apiKey: { id: index }, count: index * 10 }));
    const result = outlineOf(records);
    expect(row(result, '$[*].count')).toMatchObject({ sensitive: false, numbers: { min: '0', max: '40' } });
    expect(row(result, '$[*].pin')).toMatchObject({ sensitive: true, numbers: null });
    expect(row(result, '$[*].token')).toMatchObject({ sensitive: true, length: null });
    expect(row(result, '$[*].apiKey.id')).toMatchObject({ sensitive: true, numbers: null });
    // With fewer than five distinct values, the ends of a range are close to the values themselves.
    expect(row(outlineOf([{ port: 8080 }, { port: 8080 }]), '$[*].port').numbers).toBeNull();
    expect(row(outlineOf([{ salary: 92000 }, { salary: 185000 }]), '$[*].salary').numbers).toBeNull();
  });

  it('keeps folded keys, settings and data-like keys private', () => {
    // A map folded into ".*" is sensitive if any of its keys is, and shows no samples then.
    const env = Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`VAR_${index}`, `value-${index}`]));
    env.DB_PASSWORD = FAKE.password;
    const folded = new OutlineBuilder({ samples: 3 });
    folded.add({ env });
    expect(folded.result().paths.find((entry) => entry.path === '$.env.*')).toMatchObject({ sensitive: true, samples: [] });
    // {"name": "API_TOKEN", "value": …}: the value is a secret.
    const settings = new OutlineBuilder({ samples: 3 });
    settings.add({ env: [{ name: 'API_TOKEN', value: 'abc' }] });
    expect(settings.result().paths.find((entry) => entry.path === '$.env[*].value')).toMatchObject({ sensitive: true, samples: [] });
    // Keys that are data (email addresses, tokens) are folded, never printed.
    const people = outlineOf({ balances: { 'alice.smith@corp.com': 1, 'bob@corp.com': 2 } });
    expect(people.paths.map((entry) => entry.path)).toEqual(['$', '$.balances', '$.balances.*']);
    const started = Date.now();
    outlineOf([`a@${'a.'.repeat(100000)} x`]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('adds records under a list root declared up front', () => {
    const builder = new OutlineBuilder();
    builder.startList('$');
    builder.add({ a: 1 }, '$[*]', '$');
    builder.add({ a: 2, b: true }, '$[*]', '$');
    builder.endList('$', 2);
    const result = builder.result();
    expect(result.roots).toBe(2);
    expect(row(result, '$')).toMatchObject({ count: 1, types: [{ type: 'array', count: 1 }], items: { min: 2, max: 2 } });
    expect(row(result, '$[*].b').presence).toBe(0.5);
  });
});

describe('renderOutline (outlineTable)', () => {
  it('renders aligned rows with details', () => {
    const records = [
      { id: 'A-1', total: 6.4, paid: true, tags: ['x'], customer: { email: 'a@x.io' }, token: 'secret-1', note: null },
      { id: 'A-2', total: 1852.5, paid: false, tags: [], customer: { email: 'b@x.io' }, token: 'secret-2', note: skKey('live-0123456789abcdefghijklmn') },
    ];
    expect(outlineTable(outlineOf({ orders: records }))).toBe(
      [
        'PATH                        TYPE         SEEN  DETAILS',
        '$                           object       1     1 key',
        '$.orders                    array        100%  2 items',
        '$.orders[*]                 object       2     7 keys',
        '$.orders[*].id              string       100%  3 chars · all distinct',
        '$.orders[*].total           number       100%  all distinct',
        '$.orders[*].paid            boolean      100%  1 true · 1 false',
        '$.orders[*].tags            array        100%  0–1 items',
        '$.orders[*].tags[*]         string       1     1 char',
        '$.orders[*].customer        object       100%  1 key',
        '$.orders[*].customer.email  string       100%  email · 6 chars · all distinct',
        '$.orders[*].token           string       100%  all distinct · sensitive: values hidden',
        '$.orders[*].note            string|null  100%  string 50% (32 chars) · null 50% · 1 distinct · 1 secret-looking value hidden',
      ].join('\n')
    );
  });

  it('shows number ranges for fields with enough distinct values', () => {
    const text = outlineTable(outlineOf([3.5, 12, 7, 99.25, 40].map((price) => ({ price }))));
    expect(text).toMatch(/\$\[\*\]\.price +number +100% +3\.5 … 99\.25 · all distinct/);
  });

  it('shows presence below 100% and distinct counts', () => {
    const records = Array.from({ length: 300 }, (_, index) => ({ kind: index % 3 === 0 ? 'a' : 'b', ...(index === 0 ? { rare: 1 } : {}), ...(index > 0 ? { common: 1 } : {}), ...(index % 2 ? { half: 1 } : {}) }));
    const text = outlineTable(outlineOf(records));
    expect(text).toMatch(/\$\[\*\]\.kind +string +100% +1 char · 2 distinct/);
    expect(text).toMatch(/\$\[\*\]\.rare +integer +<1% \(1\) *$/m);
    expect(text).toMatch(/\$\[\*\]\.common +integer +>99% \(299\) +1 distinct/);
    expect(text).toMatch(/\$\[\*\]\.half +integer +50% \(150\) +1 distinct/);
    const overflow = outlineTable(outlineOf(Array.from({ length: 1200 }, (_, index) => `v${index}`)));
    expect(overflow).toContain('1000+ distinct');
  });

  it('counts hidden secret-looking values', () => {
    expect(outlineTable(outlineOf([skKey('live-0123456789abcdefghijklmn'), skKey('live-abcdefghijklmn0123456789')]))).toContain('2 secret-looking values hidden');
  });

  it('shows samples', () => {
    expect(outlineTable(outlineOf({ a: ['x', 'y'] }, { samples: 3 }))).toContain('1 char · all distinct · e.g. "x", "y"');
  });

  it('limits rows by count and by depth', () => {
    const result = outlineOf({ a: { b: { c: 1 } }, d: 2 });
    expect(outlineTable(result, { maxPaths: 2 })).toBe(
      ['PATH  TYPE    SEEN  DETAILS', '$     object  1     2 keys', '$.a   object  100%  1 key', '… 3 more paths (use --path to focus on a part, --depth to limit nesting, or --max-paths).'].join('\n')
    );
    expect(outlineTable(result, { maxPaths: 4 }).split('\n').pop()).toBe('… 1 more path (use --path to focus on a part, --depth to limit nesting, or --max-paths).');
    expect(outlineTable(result, { depth: 1 })).toBe(
      ['PATH  TYPE     SEEN  DETAILS', '$     object   1     2 keys', '$.a   object   100%  1 key', '$.d   integer  100%', '… 2 deeper paths hidden by --depth.'].join('\n')
    );
    expect(outlineTable(result, { maxPaths: 4, depth: 2 })).toBe(
      ['PATH   TYPE     SEEN  DETAILS', '$      object   1     2 keys', '$.a    object   100%  1 key', '$.a.b  object   100%  1 key', '$.d    integer  100%', '… 1 deeper path hidden by --depth.'].join('\n')
    );
  });

  it('caps the path column width', () => {
    const key = 'k'.repeat(80);
    const lines = outlineTable(outlineOf({ [key]: 1 })).split('\n');
    expect(lines[0].indexOf('TYPE')).toBe(58);
    expect(lines[2].startsWith(`$.${key}  integer`)).toBe(true);
  });
});
