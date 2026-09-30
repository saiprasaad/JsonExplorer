/** @jest-environment node */
import { RawNumber } from '../utils/json';
import { memberPath, OutlineBuilder, renderOutline as outlineTable } from './outline';
import { FAKE, skKey, withCheckDigit } from './testing/fakeSecrets';

function outlineOf(value, options) {
  const builder = new OutlineBuilder(options);
  builder.add(value);
  return builder.result();
}

const row = (result, path) => result.paths.find((item) => item.path === path);
const pathsOf = (result) => result.paths.map((item) => item.path);
/** A name made of letters only (ka, kb, …, kba): never taken for an id. */
const word = (index) => `k${[...index.toString(26)].map((digit) => String.fromCharCode(97 + parseInt(digit, 26))).join('')}`;
const mapOf = (count, make) => Object.fromEntries(Array.from({ length: count }, (_, index) => [word(index), make(index)]));
/** Five keys that are ids, from `start`. */
const ids = (start, value = 1) => Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`u${start + index}`, value]));

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

  it('folds objects whose values are alike: 20 or more objects of one shape or lists, or more than 64 values of one type', () => {
    expect(pathsOf(outlineOf(mapOf(20, (index) => ({ plan: 'pro', seats: index }))))).toEqual(['$', '$.*', '$.*.plan', '$.*.seats']);
    expect(pathsOf(outlineOf(mapOf(19, (index) => ({ plan: 'pro', seats: index }))))).toHaveLength(1 + 19 * 3);
    expect(pathsOf(outlineOf({ ...mapOf(20, () => ({ plan: 'pro' })), extra: null }))).toEqual(['$', '$.*', '$.*.plan']);
    expect(pathsOf(outlineOf(mapOf(20, () => ({}))))).toEqual(['$', '$.*']);
    expect(pathsOf(outlineOf(mapOf(20, () => [1])))).toEqual(['$', '$.*', '$.*[*]']);
    // Objects of one kind share a key, however many optional ones they have (the packages of a lockfile all have a version).
    const packages = pathsOf(outlineOf(mapOf(70, (index) => ({ version: '1.0.0', [word(index)]: true }))));
    expect(packages.slice(0, 3)).toEqual(['$', '$.*', '$.*.version']);
    expect(packages).not.toContain('$.ka');
    // Sections of a configuration that happen to share a key are not one kind.
    expect(pathsOf(outlineOf(mapOf(20, (index) => ({ [word(index)]: 1, ...(index % 2 ? { enabled: true } : {}) }))))).toContain('$.ka');
    // Not alike: objects with different keys, values of several types, too few values of one type, or nothing but null.
    expect(pathsOf(outlineOf(mapOf(20, (index) => ({ [word(index)]: 1 }))))).toHaveLength(1 + 20 * 2);
    expect(pathsOf(outlineOf(mapOf(70, (index) => [index, 'text', true][index % 3])))).toHaveLength(71);
    expect(pathsOf(outlineOf(mapOf(30, () => 'text')))).toHaveLength(31);
    expect(pathsOf(outlineOf(mapOf(20, () => null)))).toHaveLength(21);
    // However different, more than 1,000 keys are a map.
    expect(pathsOf(outlineOf(mapOf(1001, (index) => [index, 'text', true][index % 3])))).toEqual(['$', '$.*']);
  });

  it('folds objects keyed by ids, prefixed ones too', () => {
    expect(pathsOf(outlineOf(ids(1001, { plan: 'pro' })))).toEqual(['$', '$.*', '$.*.plan']);
    expect(pathsOf(outlineOf(Object.fromEntries(['cus_N3fFrFe8xq', 'cus_P2kLmZ7wrt', 'SKU-12345', 'SKU-12346', 'ord_000123'].map((key) => [key, 1]))))).toEqual(['$', '$.*']);
    expect(pathsOf(outlineOf({ md5: 'a', sha1: 'b', sha256: 'c', user_settings: 'd', max_connections: 5 }))).toHaveLength(6);
  });

  it('folds keys that keep changing where objects repeat, once they settle it, merging what came before', () => {
    const records = Array.from({ length: 70 }, (_, index) => ({ m: { [word(index)]: { age: index } } }));
    const result = outlineOf(records);
    expect(pathsOf(result)).toEqual(['$', '$[*]', '$[*].m', '$[*].m.*', '$[*].m.*.age']);
    expect(row(result, '$[*].m.*')).toMatchObject({ count: 70, presence: null, keys: { min: 1, max: 1 } });
    expect(row(result, '$[*].m.*.age')).toMatchObject({ count: 70, presence: 1, numbers: { min: '0', max: '69' }, distinct: 70 });
    // Keys that recur are the fields of records, however many: never folded.
    const wide = Array.from({ length: 10 }, () => Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field${index}`, 'text'])));
    expect(pathsOf(outlineOf(wide))).toHaveLength(102);
    // Changing keys with values of several types are not settled until there are more than 1,000 of them.
    const mixed = (count) => Array.from({ length: count }, (_, index) => ({ m: { [word(index)]: [index, 'text'][index % 2] } }));
    expect(pathsOf(outlineOf(mixed(70)))).toHaveLength(73);
    expect(pathsOf(outlineOf(mixed(1001)))).toEqual(['$', '$[*]', '$[*].m', '$[*].m.*']);
    // After 1,000 objects with recurring keys, a path is no longer watched.
    const steady = outlineOf(Array.from({ length: 1002 }, () => ({ a: 1 })));
    expect(pathsOf(steady)).toEqual(['$', '$[*]', '$[*].a']);
  });

  it('merges what earlier objects held under their keys when a later one shows the path is a map', () => {
    const result = outlineOf(
      [
        { m: { 'a@x.io': 'mail', a: 'x', b: 'y', c: 'x', flag: true, text: 'hello', list: [1, 2] } },
        { m: { a: 'x', email: 'b@x.io', flag: false } },
        { m: ids(1001, 'x') },
      ],
      { samples: 3, top: 2 }
    );
    expect(pathsOf(result)).toEqual(['$', '$[*]', '$[*].m', '$[*].m.*', '$[*].m.*[*]']);
    expect(row(result, '$[*].m.*')).toMatchObject({
      count: 15,
      types: [
        { type: 'array', count: 1 },
        { type: 'string', count: 12 },
        { type: 'boolean', count: 2 },
      ],
      booleans: { true: 1, false: 1 },
      length: { min: 1, max: 6 },
      items: { min: 2, max: 2 },
      samples: ['"mail"', '"x"', '"y"'],
      top: [{ shown: '"x"', count: 8 }],
    });
    expect(row(result, '$[*].m.*[*]')).toMatchObject({ count: 2, numbers: null, distinct: 2 });
  });

  it('merges distinct counts up to their limit, and sensitivity', () => {
    const range = (from, to) => Array.from({ length: to - from }, (_, index) => from + index);
    const merged = (first) => row(outlineOf([{ m: first }, { m: ids(1001) }]), '$[*].m.*[*]');
    expect(merged({ b: range(0, 600), a: range(600, 1200) }).distinct).toBe('1000+');
    expect(merged({ b: [1, 2], a: range(0, 1001) }).distinct).toBe('1000+');
    expect(merged({ a: range(0, 1001), b: [1, 2] }).distinct).toBe('1000+');
    const secret = outlineOf([{ m: { note: 'hi', token: 'abc' } }, { m: ids(1001, 'x') }], { samples: 3 });
    expect(row(secret, '$[*].m.*')).toMatchObject({ sensitive: true, samples: [] });
  });

  it('keeps a map a map after its path moves into a map above it', () => {
    const result = outlineOf([{ m: { alice: { tags: ids(1001) } } }, { m: ids(2001, {}) }, { m: { bob: { tags: { x: 1 } } } }]);
    expect(pathsOf(result)).toEqual(['$', '$[*]', '$[*].m', '$[*].m.*', '$[*].m.*.tags', '$[*].m.*.tags.*']);
    expect(row(result, '$[*].m.*.tags.*')).toMatchObject({ count: 6 });
  });

  it('outlines a part of a document as secret as the name above it, and knows the name it sits under', () => {
    const builder = new OutlineBuilder({ samples: 2 });
    builder.add({ user: 'ops', n: 1 }, { path: '$.credentials', sensitive: true });
    expect(row(builder.result(), '$.credentials.user')).toMatchObject({ sensitive: true, samples: [] });
    const id = withCheckDigit(`4${'2'.repeat(17)}`);
    const named = new OutlineBuilder({ samples: 2 });
    named.add(id, { key: 'orderId' });
    expect(row(named.result(), '$')).toMatchObject({ samples: [`"${id}"`], secretValues: 0 });
    expect(row(outlineOf(id, { samples: 2 }), '$')).toMatchObject({ samples: [], secretValues: 1 });
    // List items go by the list's name.
    expect(row(outlineOf({ orderIds: [id], codes: [id] }, { samples: 2 }), '$.orderIds[*]')).toMatchObject({ samples: [`"${id}"`], secretValues: 0 });
    expect(row(outlineOf({ orderIds: [id], codes: [id] }, { samples: 2 }), '$.codes[*]')).toMatchObject({ samples: [], secretValues: 1 });
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

  it('counts the most common values on request, the most frequent first', () => {
    const records = ['b', 'a', 'b', 'c', 'a', 'b', FAKE.githubToken].map((tag, index) => ({ tag, n: index < 4 ? 1 : 2, secret: 'x', ok: true }));
    const result = outlineOf(records, { top: 2 });
    expect(row(result, '$[*].tag').top).toEqual([
      { shown: '"b"', count: 3 },
      { shown: '"a"', count: 2 },
    ]);
    expect(row(result, '$[*].n').top).toEqual([
      { shown: '1', count: 4 },
      { shown: '2', count: 3 },
    ]);
    expect(row(result, '$[*].secret').top).toEqual([]);
    expect(row(result, '$[*].ok').top).toEqual([]);
    expect(row(outlineOf(records), '$[*].tag').top).toEqual([]);
    // Past the limit on distinct values, nothing is counted.
    const many = outlineOf(Array.from({ length: 1002 }, (_, index) => ({ id: `id-${index}` })), { top: 3 });
    expect(row(many, '$[*].id')).toMatchObject({ distinct: '1000+', top: [] });
  });

  it('never samples card numbers, session ids or IBANs', () => {
    const records = [
      { creditCard: FAKE.visaCard, session: 'a1b2c3d4e5', iban: 'XX00TEST0000', note: FAKE.mastercard, city: 'Paris' },
      { creditCard: FAKE.amexCard, session: 'f6g7h8i9j0', iban: 'XX00TEST0001', note: 'hello', city: 'Rome' },
    ];
    const result = outlineOf(records, { samples: 2 });
    ['creditCard', 'session', 'iban'].forEach((key) => expect(row(result, `$[*].${key}`)).toMatchObject({ sensitive: true, samples: [] }));
    expect(row(result, '$[*].note')).toMatchObject({ samples: ['"hello"'], secretValues: 1 });
    expect(row(result, '$[*].city').samples).toEqual(['"Paris"', '"Rome"']);
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
    // Only such a key folds: its siblings keep their paths.
    const mixed = outlineOf({ user: { id: 1 }, env: { HOME: '/h' }, [FAKE.githubToken]: true, note: 'hi' });
    expect(mixed.paths.map((entry) => entry.path)).toEqual(['$', '$.user', '$.user.id', '$.env', '$.env.HOME', '$.*', '$.note']);
    expect(row(mixed, '$.*')).toMatchObject({ count: 1, presence: null });
    const started = Date.now();
    outlineOf([`a@${'a.'.repeat(100000)} x`]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('adds records under a list root declared up front', () => {
    const builder = new OutlineBuilder();
    builder.startList('$');
    builder.add({ a: 1 }, { path: '$[*]', parent: '$' });
    builder.add({ a: 2, b: true }, { path: '$[*]', parent: '$' });
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
