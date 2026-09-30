/** @jest-environment node */
import { compileJsonPath, compilePath, compileRecordQuery, JsonPathError, normalizedPath, translateIRegexp } from './jsonpath';

const values = (expression, document) => compilePath(expression).evaluate(document).map((node) => node.value);

describe('translateIRegexp', () => {
  it.each([
    ['a.c', 'a(?:(?![\\n\\r])[\\s\\S])c'],
    ['[^abc]', '(?:(?![abc])[\\s\\S])'],
    ['[^^a]', '(?:(?![\\^a])[\\s\\S])'],
    ['[-a]', '[\\-a]'],
    ['[a-]', '[a\\-]'],
    ['[a-c]', '[a-c]'],
    ['[\\]-\\^]', '[\\]-\\^]'],
    ['[a-\\}]', '[a-\\}]'],
    ['[\\p{L}_]', '[\\p{L}_]'],
    ['\\P{Nd}+', '\\P{Nd}+'],
    ['x{2}', 'x{2}'],
    ['x{2,}', 'x{2,}'],
    ['x{2,3}', 'x{2,3}'],
    ['(ab|cd)*', '(?:ab|cd)*'],
    ['a|b|', 'a|b|'],
    ['\\-\\n\\.', '-\\n\\.'],
    ['[a\\-z]', '[a\\-z]'],
    ['^a$', '^a$'],
  ])('translates %s', (pattern, source) => {
    expect(translateIRegexp(pattern)).toBe(source);
  });

  it.each([
    '[abc',
    '[]',
    '[a[b]',
    '[a-\\p{L}]',
    '[a-\\q]',
    '[\\d-z]',
    '[a-b-c]',
    '[a-[]',
    '[a--z]',
    'x{3,2}',
    'x{a}',
    'a)',
    '(a',
    '*a',
    'a**',
    '}',
    '\\d',
    '\\p{Xyz}',
    '\\p{L',
    '\\pL',
  ])('rejects %s', (pattern) => {
    expect(translateIRegexp(pattern)).toBeNull();
  });
});

describe('regular expressions in filters', () => {
  const doc = ['Timeout', 'timeout reached', 'ok', 'A1', 'a-1', 'Été'];

  it('treats a character outside the Basic Multilingual Plane as one character, on every Node version', () => {
    const emoji = String.fromCodePoint(0x1f600);
    const strings = [`a${emoji}b`, `a${emoji}${emoji}b`, 'ab', 'a\nb', '^'];
    expect(values("$[?match(@, 'a.b')]", strings)).toEqual([`a${emoji}b`]);
    expect(values("$[?match(@, 'a[^x]b')]", strings)).toEqual([`a${emoji}b`, 'a\nb']);
    expect(values("$[?match(@, 'a[^a-z]+b')]", strings)).toEqual([`a${emoji}b`, `a${emoji}${emoji}b`, 'a\nb']);
    expect(values("$[?search(@, '[^^ab]')]", strings)).toEqual([`a${emoji}b`, `a${emoji}${emoji}b`, 'a\nb']);
  });

  it('matches whole strings with match() and parts with search()', () => {
    expect(values("$[?match(@, '[Tt]imeout')]", doc)).toEqual(['Timeout']);
    expect(values("$[?search(@, '[Tt]imeout')]", doc)).toEqual(['Timeout', 'timeout reached']);
    expect(values("$[?match(@, '\\\\p{Lu}\\\\p{Ll}+')]", doc)).toEqual(['Timeout', 'Été']);
    expect(values("$[?match(@, '[a-zA-Z]\\\\-?[0-9]')]", doc)).toEqual(['A1', 'a-1']);
  });

  it('treats invalid patterns as matching nothing', () => {
    expect(values("$[?match(@, '(unclosed')]", doc)).toEqual([]);
    expect(values("$[?match(@, '[z-a]')]", doc)).toEqual([]);
    expect(values("$[?search(@, '\\\\p{Lx}')]", doc)).toEqual([]);
  });

  it('combines function results with logical operators', () => {
    const records = [
      { a: 'x1', b: true },
      { a: 'x2' },
      { a: 'y', b: true },
    ];
    expect(values("$[?match(@.a, 'x.') && @.b]", records)).toEqual([records[0]]);
    expect(values("$[?search(@.a, 'y') || !@.b]", records)).toEqual([records[1], records[2]]);
    expect(values('$[?length(@.a) == 2 && @.b]', records)).toEqual([records[0]]);
    expect(values('$[?count(@.*) > 1 || @.a == "x2"]', records)).toEqual(records);
  });
});

describe('JsonPathError', () => {
  it.each([
    ["$['a'", "expected ']' to close the selector but the expression ended"],
    ["$['\\ud800x']", 'a high surrogate escape must be followed by a low surrogate'],
    ["$['\\udc00']", 'lone low surrogate escape'],
    ["$['\uD800x']", 'lone surrogate in a string'],
    ["$['\uDC00']", 'lone surrogate in a string'],
    ["$['\\", "invalid escape '\\'"],
    ['$[?length', "unknown name 'length'"],
    ['$[?', 'the filter ended unexpectedly'],
    ['$[?foo(@) == 1]', "unknown function 'foo()'"],
    ['$[?length(!@.a) == 1]', 'wrong kind of argument for length()'],
    ['$[?length(@.a == 1) == 1]', 'wrong kind of argument for length()'],
    ['$[?length(@.a && @.b) == 1]', 'wrong kind of argument for length()'],
    ['$[?count(1) == 1]', 'wrong kind of argument for count()'],
  ])('explains %s', (expression, message) => {
    expect(() => compileJsonPath(expression)).toThrow(message);
  });

  it('accepts supplementary characters written as surrogate pairs', () => {
    expect(values("$['\\ud83d\\ude00']", { '\u{1F600}': 1 })).toEqual([1]);
    expect(values("$['\\ue000']", { '\ue000': 2 })).toEqual([2]);
  });

  it('reports the position of the problem', () => {
    expect(() => compileJsonPath('$.a[')).toThrow(JsonPathError);
    let error;
    try {
      compileJsonPath('$..');
    } catch (caught) {
      error = caught;
    }
    expect(error.name).toBe('JsonPathError');
    expect(error.message).toMatch(/\(at position \d+\)$/);
    expect(new JsonPathError('plain').message).toBe('plain');
  });
});

describe('JSON Pointer', () => {
  const doc = { a: [10, { 'b/c': 1, 'd~e': 2 }], '': 'empty key' };

  it('resolves pointers, including escapes and the empty key', () => {
    expect(values('', doc)).toEqual([doc]);
    expect(values('/a/0', doc)).toEqual([10]);
    expect(values('/a/1/b~1c', doc)).toEqual([1]);
    expect(values('/a/1/d~0e', doc)).toEqual([2]);
    expect(values('/', doc)).toEqual(['empty key']);
    expect(compilePath('/a/0')).toMatchObject({ kind: 'pointer', singular: true });
  });

  it('selects nothing when the pointer does not lead anywhere', () => {
    expect(values('/a/2', doc)).toEqual([]);
    expect(values('/a/01', doc)).toEqual([]);
    expect(values('/a/-', doc)).toEqual([]);
    expect(values('/a/0/x', doc)).toEqual([]);
    expect(values('/missing', doc)).toEqual([]);
    expect(values('/a/1/constructor', doc)).toEqual([]);
  });

  it('rejects bad escapes', () => {
    expect(() => compilePath('/a~2')).toThrow('Invalid JSON Pointer: bad escape in "a~2" (use ~0 for ~ and ~1 for /)');
  });

  it('gives node paths that format back to the same place', () => {
    const [node] = compilePath('/a/1/b~1c').evaluate(doc);
    expect(node.path).toEqual(['a', 1, 'b/c']);
    expect(normalizedPath(node.path)).toBe("$['a'][1]['b/c']");
  });
});

describe('normalizedPath', () => {
  it('escapes names as RFC 9535 requires', () => {
    expect(normalizedPath([])).toBe('$');
    expect(normalizedPath(["it's", 'back\\slash', '\b\f\n\r\t', '\u0001', 'é'])).toBe("$['it\\'s']['back\\\\slash']['\\b\\f\\n\\r\\t']['\\u0001']['é']");
  });
});

describe('compileJsonPath', () => {
  it('knows which paths select at most one node', () => {
    expect(compileJsonPath('$.a[0].b').singular).toBe(true);
    expect(compileJsonPath('$').singular).toBe(true);
    expect(compileJsonPath('$.a[*]').singular).toBe(false);
    expect(compileJsonPath('$..a').singular).toBe(false);
    expect(compileJsonPath('$.a[0,1]').singular).toBe(false);
    expect(compileJsonPath('$.a[0:1]').singular).toBe(false);
  });
});

describe('compileRecordQuery', () => {
  const records = [{ level: 'info' }, { level: 'error', user: { id: 7 } }, { level: 'error' }];
  const run = (query) => records.flatMap((record, index) => query.match(record, index).map((node) => ({ path: node.path, value: node.value })));

  it('streams wildcard, index, slice and filter selections', () => {
    const all = compileRecordQuery('$[*].level');
    expect(all.last).toBe(Infinity);
    expect(run(all).map((node) => node.value)).toEqual(['info', 'error', 'error']);
    const one = compileRecordQuery('$[1].user.id');
    expect(one.last).toBe(1);
    expect(run(one)).toEqual([{ path: [1, 'user', 'id'], value: 7 }]);
    const slice = compileRecordQuery('$[0:3:2]');
    expect(slice.last).toBe(2);
    expect(run(slice).map((node) => node.path)).toEqual([[0], [2]]);
    expect(compileRecordQuery('$[1:]').last).toBe(Infinity);
    expect(compileRecordQuery('$[:2]').last).toBe(1);
    const filter = compileRecordQuery('$[?@.level == "error"].level');
    expect(run(filter).map((node) => node.path)).toEqual([
      [1, 'level'],
      [2, 'level'],
    ]);
  });

  it('declines queries that need the whole list', () => {
    ['$', '$..level', '$[0,1]', '$[-1]', '$[-2:]', '$[:-1]', '$[::-1]', '$[?@.level == $[0].level]', '$.level', "$['x']"].forEach((expression) => {
      expect(compileRecordQuery(expression)).toBeNull();
    });
  });
});
