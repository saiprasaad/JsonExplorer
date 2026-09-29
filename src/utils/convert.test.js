import { isTabular, tabulate, toCsv, toJsonSchema, toTypeScript, toYaml } from './convert';
import { RawNumber } from './json';

describe('toTypeScript', () => {
  test('generates named interfaces with optional properties and unions', () => {
    const output = toTypeScript({
      id: 1,
      name: 'Store',
      products: [
        { sku: 'A', price: 9.5, tags: ['x'] },
        { sku: 'B', price: 10, discount: null },
      ],
      'content-type': 'json',
    });
    expect(output).toBe(
      [
        'export interface Root {',
        '  id: number;',
        '  name: string;',
        '  products: Product[];',
        '  "content-type": string;',
        '}',
        '',
        'export interface Product {',
        '  sku: string;',
        '  price: number;',
        '  tags?: string[];',
        '  discount?: null; // only null in the sample',
        '}',
        '',
      ].join('\n')
    );
  });

  test('reuses identical structures and handles root arrays and primitives', () => {
    const output = toTypeScript([{ home: { city: 'A' }, work: { city: 'B' } }]);
    expect(output).toContain('export type Root = RootItem[];');
    expect(output).toContain('export interface RootItem {\n  home: Home;\n  work: Home;\n}');
    expect(output.match(/interface Home/g)).toHaveLength(1);
    expect(toTypeScript('text')).toBe('export type Root = string;\n');
    expect(toTypeScript([1, 'a', null])).toBe('export type Root = (number | string | null)[];\n');
    expect(toTypeScript([])).toBe('export type Root = unknown[];\n');
  });

  test('never reuses the root name for nested types', () => {
    const output = toTypeScript({ root: { a: 1 } });
    expect(output).toContain('export interface Root {\n  root: Root2;\n}');
    expect(output).toContain('export interface Root2 {\n  a: number;\n}');
  });
});

describe('toJsonSchema', () => {
  test('infers types, required keys and string formats', () => {
    const schema = JSON.parse(
      toJsonSchema({
        users: [
          { id: 1, email: 'a@example.com', joined: '2025-01-02T03:04:05Z', site: 'https://a.dev' },
          { id: 2.5, email: 'b@example.com', joined: '2025-02-03T04:05:06Z' },
        ],
        maybe: null,
      })
    );
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.required).toEqual(['users', 'maybe']);
    expect(schema.properties.maybe).toEqual({ type: 'null' });
    const item = schema.properties.users.items;
    expect(item.properties).toEqual({
      id: { type: 'number' },
      email: { type: 'string', format: 'email' },
      joined: { type: 'string', format: 'date-time' },
      site: { type: 'string', format: 'uri' },
    });
    expect(item.required).toEqual(['id', 'email', 'joined']);
  });

  test('uses type arrays for simple unions and anyOf otherwise', () => {
    expect(JSON.parse(toJsonSchema([1, null])).items).toEqual({ type: ['integer', 'null'] });
    expect(JSON.parse(toJsonSchema([1, { a: 1 }])).items.anyOf).toHaveLength(2);
  });
});

describe('toYaml', () => {
  test('serializes nested structures in block style', () => {
    expect(
      toYaml({
        name: 'Ada',
        tags: ['math', 'code'],
        address: { city: 'London', zip: null },
        items: [{ id: 1, qty: 2 }, [1, 2], []],
        empty: {},
      })
    ).toBe(
      [
        'name: Ada',
        'tags:',
        '  - math',
        '  - code',
        'address:',
        '  city: London',
        '  zip: null',
        'items:',
        '  - id: 1',
        '    qty: 2',
        '  - - 1',
        '    - 2',
        '  - []',
        'empty: {}',
        '',
      ].join('\n')
    );
  });

  test('quotes strings that YAML would otherwise misread', () => {
    const yaml = toYaml({ a: 'true', b: '123', c: 'key: value', d: '', e: ' padded', f: 'line\nbreak', g: '#tag', 'odd key:': 1, h: 'plain text' });
    expect(yaml).toBe(
      [
        'a: "true"',
        'b: "123"',
        'c: "key: value"',
        'd: ""',
        'e: " padded"',
        'f: "line\\nbreak"',
        'g: "#tag"',
        '"odd key:": 1',
        'h: plain text',
        '',
      ].join('\n')
    );
    expect(toYaml(42)).toBe('42\n');
  });

  test('quotes what YAML 1.1 parsers treat specially and escapes what YAML forbids raw', () => {
    const yaml = toYaml({ '<<': { a: 1 }, eq: '=', inf: '+.INF', end: '...', dots: '... x', c1: 'don\u00e2\u0080\u0099t', ls: 'a\u2028b', del: 'a\u007fb' });
    expect(yaml).toBe(
      [
        '"<<":',
        '  a: 1',
        'eq: "="',
        'inf: "+.INF"',
        'end: "..."',
        'dots: "... x"',
        'c1: "don\u00e2\\u0080\\u0099t"',
        'ls: "a\\u2028b"',
        'del: "a\\u007fb"',
        '',
      ].join('\n')
    );
  });

  test('writes exponent floats with a dot and keeps exact integers', () => {
    expect(toYaml({ big: 1e21, small: 1e-7, exact: new RawNumber('12345678901234567890'), raw: new RawNumber('1E5'), kept: new RawNumber('1.50') })).toBe(
      'big: 1.0e+21\nsmall: 1.0e-7\nexact: 12345678901234567890\nraw: 1.0e+5\nkept: 1.50\n'
    );
  });

  test('uses explicit keys for keys longer than YAML allows implicitly', () => {
    const key = 'k'.repeat(1200);
    expect(toYaml({ [key]: 1, nested: { [key]: { a: 1 } } })).toBe(
      [`? ${key}`, ': 1', 'nested:', `  ? ${key}`, '  :', '    a: 1', ''].join('\n')
    );
  });
});

describe('tables and CSV', () => {
  test('tabulate flattens nested objects into dotted columns', () => {
    const table = tabulate([
      { id: 1, owner: { name: 'Ada', team: { id: 7 } }, tags: ['a'] },
      { id: 2, extra: true },
    ]);
    expect(table.columns).toEqual(['id', 'owner.name', 'owner.team.id', 'tags', 'extra']);
    expect(table.rows[0].values).toEqual([1, 'Ada', 7, ['a'], undefined]);
    expect(table.rows[1].values).toEqual([2, undefined, undefined, undefined, true]);
  });

  test('tabulate supports dictionaries of records, matrices and primitives', () => {
    expect(tabulate({ u1: { age: 3 }, u2: { age: 4 } })).toEqual({
      columns: ['key', 'age'],
      keyed: true,
      rows: [
        { key: 'u1', values: ['u1', 3] },
        { key: 'u2', values: ['u2', 4] },
      ],
    });
    expect(tabulate([[1, 2], [3]]).columns).toEqual(['0', '1']);
    expect(tabulate(['a', 'b']).columns).toEqual(['value']);
    expect(tabulate('text')).toBeNull();
    expect(tabulate([])).toBeNull();
  });

  test('isTabular accepts arrays and dictionaries of records only', () => {
    expect(isTabular([1])).toBe(true);
    expect(isTabular({ a: { x: 1 }, b: { x: 2 } })).toBe(true);
    expect(isTabular({ a: 1, b: { x: 2 } })).toBe(false);
    expect(isTabular([])).toBe(false);
    expect(isTabular('x')).toBe(false);
  });

  test('toCsv quotes special characters and neutralises formulas', () => {
    const csv = toCsv([
      { name: 'Ada, Countess', quote: 'say "hi"', formula: '=SUM(A1)', list: [1, 2] },
      { name: 'Bob', quote: null, formula: 'ok', list: [] },
    ]);
    expect(csv).toBe(
      ['name,quote,formula,list', '"Ada, Countess","say ""hi""",\'=SUM(A1),"[1,2]"', 'Bob,,ok,[]', ''].join('\r\n')
    );
    expect(() => toCsv(5)).toThrow(/CSV needs an array/);
  });

  test('column names never collide, so no cell is lost', () => {
    expect(tabulate([{ 'a.b': 1, a: { b: 2 }, '': 3, value: 4 }]).columns).toEqual(['["a.b"]', 'a.b', '[""]', 'value']);
    expect(tabulate([{ owner: { 'first.name': 'Ada' } }]).columns).toEqual(['owner["first.name"]']);
    // A dictionary's key column steps aside for a record field called "key".
    expect(tabulate({ u1: { key: 'x' }, u2: { key: 'y' } })).toMatchObject({
      columns: ['(key)', 'key'],
      rows: [
        { key: 'u1', values: ['u1', 'x'] },
        { key: 'u2', values: ['u2', 'y'] },
      ],
    });
  });

  test('CSV keeps exact large integers, including inside JSON cells', () => {
    expect(toCsv([{ id: new RawNumber('12345678901234567890'), ids: [new RawNumber('12345678901234567891'), new RawNumber('1.50')] }])).toBe(
      'id,ids\r\n12345678901234567890,"[12345678901234567891,1.50]"\r\n'
    );
  });
});

describe('schema and type inference edge cases', () => {
  test('a "__proto__" key is kept as a property', () => {
    const value = JSON.parse('{"__proto__": {"x": 1}, "b": "s"}');
    const schema = JSON.parse(toJsonSchema(value));
    expect(Object.keys(schema.properties)).toEqual(['__proto__', 'b']);
    expect(schema.required).toEqual(['__proto__', 'b']);
  });

  test('exact large integers are integers', () => {
    const exact = { id: new RawNumber('12345678901234567890'), price: new RawNumber('1.50'), whole: new RawNumber('2.0') };
    expect(JSON.parse(toJsonSchema(exact)).properties).toEqual({ id: { type: 'integer' }, price: { type: 'number' }, whole: { type: 'integer' } });
    expect(toTypeScript(exact)).toContain('id: number;');
  });

  test('inference stays fast for many records with distinct keys', () => {
    const records = Array.from({ length: 20000 }, (_, i) => ({ [`k${i}`]: i }));
    const started = Date.now();
    toJsonSchema(records);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
