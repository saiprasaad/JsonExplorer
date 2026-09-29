import {
  computeStats,
  findPathRange,
  formatBytes,
  formatJson,
  formatPath,
  getPathAtOffset,
  getValueAtPath,
  getValueType,
  isContainer,
  isIntegerNumber,
  isNumber,
  mayContainInexactNumbers,
  minifyJson,
  numberKey,
  parseJson,
  previewValue,
  RawNumber,
  sliceText,
  sortJsonKeys,
  stringifyJson,
  toNumber,
  truncate,
  utf8ByteLength,
} from './json';

describe('exact numbers', () => {
  test('spots literals that plain JSON.parse and JSON.stringify would change', () => {
    ['12345678901234567890', '1.50', '1e5', '-0', '0.1000000000000000055'].forEach((literal) => expect(mayContainInexactNumbers(`[${literal}]`)).toBe(true));
    ['1', '1.5', '-12', '0.25'].forEach((literal) => expect(mayContainInexactNumbers(`[${literal}]`)).toBe(false));
  });

  describe('on engines without JSON.parse source text access or JSON.rawJSON (Node.js before 21)', () => {
    const { parse, rawJSON } = JSON;
    let legacy;
    beforeAll(() => {
      // A reviver that never receives the source text, and no JSON.rawJSON.
      JSON.parse = (text, reviver) => parse(text, reviver && ((key, value) => reviver(key, value)));
      delete JSON.rawJSON;
      jest.isolateModules(() => {
        legacy = require('./json');
      });
    });
    afterAll(() => {
      JSON.parse = parse;
      JSON.rawJSON = rawJSON;
    });

    test('parses and writes every literal exactly as written', () => {
      const text = '{"id": 12345678901234567890, "price": 1.50, "neg": -0, "big": 1e400, "__proto__": {"x": 1}, "list": [1, 2.0, "s", true, null], "nested": {"a": [1.10]}, "id": 7}';
      const { value, rounded } = legacy.parseJson(text, { exact: true });
      expect(rounded).toBeUndefined();
      expect(value.price).toBeInstanceOf(legacy.RawNumber);
      expect(Object.keys(value)).toEqual(['id', 'price', 'neg', 'big', '__proto__', 'list', 'nested']);
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
      expect(legacy.stringifyJson(value)).toBe('{"id":7,"price":1.50,"neg":-0,"big":1e400,"__proto__":{"x":1},"list":[1,2.0,"s",true,null],"nested":{"a":[1.10]}}');
      expect(legacy.stringifyJson(legacy.parseJson('[12345678901234567890, "12345678901234567890"]', { exact: true }).value, 1)).toBe('[\n 12345678901234567890,\n "12345678901234567890"\n]');
      expect(legacy.stringifyJson({ plain: 'text' })).toBe('{"plain":"text"}');
      expect(legacy.parseJson('{"a": 1.5}', { exact: true }).value).toEqual({ a: 1.5 });
    });

    test('rounds, and says so, only when a document is nested too deeply to parse exactly', () => {
      const deep = `${'['.repeat(100000)}1.50${']'.repeat(100000)}`;
      expect(legacy.parseJson(deep, { exact: true })).toMatchObject({ ok: true, rounded: true });
      expect(legacy.parseJson('[1.50', { exact: true })).toMatchObject({ ok: false });
    });
  });
});

describe('parseJson', () => {
  test('parses valid JSON', () => {
    expect(parseJson('{"a": [1, 2]}')).toEqual({ ok: true, value: { a: [1, 2] } });
    expect(parseJson('42')).toEqual({ ok: true, value: 42 });
  });

  test('reports empty documents separately from errors', () => {
    expect(parseJson('   \n ')).toEqual({ ok: false, empty: true, error: null });
  });

  test('accepts a leading byte order mark', () => {
    expect(parseJson('\uFEFF{"a": 1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  test.each([
    ['trailing comma in object', '{\n  "a": 1,\n}', "Trailing comma before '}' is not allowed", 2, 9],
    ['trailing comma in array', '[1, 2,]', "Trailing comma before ']' is not allowed", 1, 6],
    ['single quotes', "{'a': 1}", 'Strings and property names must use double quotes', 1, 2],
    ['unquoted key', '{a: 1}', 'Property names must be wrapped in double quotes', 1, 2],
    ['comment', '{"a": 1 // note\n}', 'Comments are not allowed in JSON', 1, 9],
    ['missing comma', '{"a": 1 "b": 2}', "Expected ',' between items", 1, 9],
    ['missing colon', '{"a" 1}', "Expected ':' after the property name", 1, 6],
    ['unclosed object', '{"a": 1', "Unexpected end of input — expected '}' to close the object", 1, 8],
    ['python literal', '{"a": None}', "'None' is not valid JSON — use null", 1, 7],
    ['undefined', '[undefined]', "'undefined' is not valid JSON — use null", 1, 2],
    ['NaN', '[NaN]', "'NaN' is not a valid JSON number", 1, 2],
    ['leading zero', '[01]', 'Numbers cannot have leading zeros', 1, 2],
    ['content after value', '{} {}', 'Unexpected content after the end of the JSON value', 1, 4],
    ['raw tab in string', '["a\tb"]', 'Control characters (tabs, line breaks) must be escaped inside strings', 1, 4],
    ['bad escape', '["a\\qb"]', "Invalid escape sequence '\\q' in string", 1, 4],
    ['negative infinity', '[-Infinity]', "'-Infinity' is not a valid JSON number", 1, 2],
    ['signed NaN', '{"x": -NaN}', "'-NaN' is not a valid JSON number", 1, 7],
    ['leading plus', '[+1]', "Numbers cannot start with '+'", 1, 2],
    ['line break in string', '{"a": "line\nbreak"}', 'Line breaks inside strings must be escaped as \\n', 1, 12],
    ['unterminated string', '{"a": "never closed', 'Unterminated string — the closing quote is missing', 1, 7],
    ['identifier that is also an Object.prototype key', '{"a": constructor}', 'Unexpected text — strings must be in double quotes', 1, 7],
    ['unquoted text, not quoted back (it may be a password)', '{"a": plaintext}', 'Unexpected text — strings must be in double quotes', 1, 7],
    ['punctuation', '{"a": ;}', "Unexpected character ';'", 1, 7],
    ['a run of symbols', '{"a": ;;}', 'Unexpected characters', 1, 7],
  ])('explains %s', (_, text, message, line, column) => {
    const result = parseJson(text);
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ message, line, column });
  });

  test('survives invalid input nested too deeply for the detailed parser', () => {
    const result = parseJson('['.repeat(20000));
    expect(result.ok).toBe(false);
    expect(result.error.message).toBeTruthy();
  });

  test('exact mode keeps every number literal a double cannot reproduce', () => {
    const text = '{"id": 1234567890123456789, "small": 12, "float": 1.5, "price": 1.50, "exp": 1e21, "neg": -0, "pi": 3.14159265358979323846}';
    expect(parseJson(text).value.id).toBe(1234567890123456800);
    const exact = parseJson(text, { exact: true }).value;
    expect(exact.small).toBe(12);
    expect(exact.float).toBe(1.5);
    ['id', 'price', 'exp', 'neg', 'pi'].forEach((key) => expect(exact[key]).toBeInstanceOf(RawNumber));
    expect(exact.id.source).toBe('1234567890123456789');
    expect(getValueType(exact.id)).toBe('number');
    expect(isContainer(exact.id)).toBe(false);
    expect(previewValue(exact.pi)).toBe('3.14159265358979323846');
    expect(stringifyJson(exact)).toBe('{"id":1234567890123456789,"small":12,"float":1.5,"price":1.50,"exp":1e21,"neg":-0,"pi":3.14159265358979323846}');
    // Plain JSON.stringify still works, with ordinary (rounded) numbers.
    expect(JSON.stringify({ n: exact.price })).toBe('{"n":1.5}');
  });

  test('skips the slower exact parse when no literal can be inexact', () => {
    expect(mayContainInexactNumbers('{"a": [1, 2.5, -3, 1234567890]}')).toBe(false);
    ['[12345678901234567]', '[1.234567890123456]', '[1e5]', '[1.50]', '[-0]'].forEach((text) => expect(mayContainInexactNumbers(text)).toBe(true));
  });

  test('number helpers compare exact values however they are written', () => {
    expect(numberKey(1.5)).toBe(numberKey(new RawNumber('1.50')));
    expect(numberKey(new RawNumber('15e-1'))).toBe(numberKey(1.5));
    expect(numberKey(100)).toBe(numberKey(new RawNumber('1E2')));
    expect(numberKey(0)).toBe(numberKey(new RawNumber('-0.000')));
    expect(numberKey(new RawNumber('12345678901234567890'))).not.toBe(numberKey(new RawNumber('12345678901234567891')));
    expect(numberKey('not a number')).toBe('not a number');
    expect(isNumber(new RawNumber('1'))).toBe(true);
    expect(isNumber('1')).toBe(false);
    expect(isIntegerNumber(new RawNumber('1.0'))).toBe(true);
    expect(isIntegerNumber(new RawNumber('1.5e1'))).toBe(true);
    expect(isIntegerNumber(new RawNumber('1e-7'))).toBe(false);
    expect(isIntegerNumber(new RawNumber('0.0'))).toBe(true);
    expect(isIntegerNumber(new RawNumber('x'))).toBe(false);
    expect(isIntegerNumber(2)).toBe(true);
    expect(isIntegerNumber('2')).toBe(false);
    expect(toNumber(new RawNumber('2.50'))).toBe(2.5);
    expect(toNumber(3)).toBe(3);
    expect(new RawNumber('7') + 1).toBe(8);
    expect(`${new RawNumber('7.0')}`).toBe('7.0');
  });
});

describe('lossless transforms', () => {
  const source = '{"b": 12345678901234567890, "a": {"z": 1.50, "y": "\\u00e9"}, "list": [], "obj": {}}';

  test('formatJson preserves literals exactly', () => {
    expect(formatJson(source)).toBe(
      [
        '{',
        '  "b": 12345678901234567890,',
        '  "a": {',
        '    "z": 1.50,',
        '    "y": "\\u00e9"',
        '  },',
        '  "list": [],',
        '  "obj": {}',
        '}',
      ].join('\n')
    );
  });

  test('formatJson supports tabs and custom indentation', () => {
    expect(formatJson('[1,{"a":2}]', '\t')).toBe('[\n\t1,\n\t{\n\t\t"a": 2\n\t}\n]');
    expect(formatJson('[1]', 4)).toBe('[\n    1\n]');
  });

  test('minifyJson removes all insignificant whitespace', () => {
    expect(minifyJson('{\n  "a" : [ 1 , 2 ],\n  "b" : "x y"\n}')).toBe('{"a":[1,2],"b":"x y"}');
  });

  test('sortJsonKeys orders keys by code point, like jq -S', () => {
    expect(sortJsonKeys('{"😀": 1, "！": 2, "b": 3, "B": 4}', 0)).toBe('{"B":4,"b":3,"！":2,"😀":1}');
  });

  test('sortJsonKeys sorts recursively and keeps literals', () => {
    expect(sortJsonKeys(source, 0)).toBe('{"a":{"y":"\\u00e9","z":1.50},"b":12345678901234567890,"list":[],"obj":{}}');
    expect(sortJsonKeys('[{"b":1,"a":2}]')).toBe('[\n  {\n    "a": 2,\n    "b": 1\n  }\n]');
  });

  test('transforms handle primitive roots', () => {
    expect(formatJson(' "text" ')).toBe('"text"');
    expect(sortJsonKeys('7')).toBe('7');
  });

  test('transforms reject invalid JSON with a helpful message', () => {
    expect(() => formatJson('{"a": }')).toThrow(/Cannot transform invalid JSON: Expected a value \(line 1, column 7\)/);
    expect(() => minifyJson('  ')).toThrow(/empty/);
  });
});

describe('paths', () => {
  const path = ['catalog', 'products', 0, 'key with space', 'a/b~c'];

  test.each([
    ['jsonpath', '$.catalog.products[0]["key with space"]["a/b~c"]'],
    ['js', 'data.catalog.products[0]["key with space"]["a/b~c"]'],
    ['jq', '.catalog.products[0]."key with space"."a/b~c"'],
    ['pointer', '/catalog/products/0/key with space/a~1b~0c'],
  ])('formats %s', (format, expected) => {
    expect(formatPath(path, format)).toBe(expected);
  });

  test('formats root paths', () => {
    expect(formatPath([], 'jsonpath')).toBe('$');
    expect(formatPath([], 'jq')).toBe('.');
    expect(formatPath([3], 'jq')).toBe('.[3]');
    expect(formatPath([], 'pointer')).toBe('');
    expect(formatPath(['$ok'], 'js')).toBe('data.$ok');
    expect(formatPath(['$ok'], 'jsonpath')).toBe('$["$ok"]');
  });

  test('getValueAtPath walks objects and arrays', () => {
    const root = { a: [{ b: null }] };
    expect(getValueAtPath(root, ['a', 0, 'b'])).toBeNull();
    expect(getValueAtPath(root, ['a', 5])).toBeUndefined();
    expect(getValueAtPath(root, ['missing', 'deeper'])).toBeUndefined();
    expect(getValueAtPath(root, [])).toBe(root);
  });
});

describe('text ↔ path mapping', () => {
  const text = '{\n  "a": {\n    "b": [10, 20]\n  }\n}';

  test('findPathRange locates values and their keys', () => {
    const range = findPathRange(text, ['a', 'b', 1]);
    expect(text.substr(range.offset, range.length)).toBe('20');
    expect(range.keyOffset).toBeNull();

    const objectRange = findPathRange(text, ['a']);
    expect(text.substr(objectRange.keyOffset, objectRange.keyLength)).toBe('"a"');
    expect(findPathRange(text, ['nope'])).toBeNull();
  });

  test('getPathAtOffset returns the path under the cursor', () => {
    expect(getPathAtOffset(text, text.indexOf('20'))).toEqual(['a', 'b', 1]);
    expect(getPathAtOffset(text, text.indexOf('"b"') + 1)).toEqual(['a', 'b']);
  });

  test('empty keys are real path segments, not placeholders', () => {
    const doc = '{"": {"b": 1}, "b": 2}';
    expect(getPathAtOffset(doc, doc.indexOf('1'))).toEqual(['', 'b']);
    expect(getPathAtOffset('{"a": 1, }', 9)).toEqual([]);
    expect(getPathAtOffset('{"a": {}}', 7)).toEqual(['a']);
  });

  test('duplicate keys resolve to the last occurrence, like JSON.parse', () => {
    const doc = '{"a": 1, "a": 2}';
    const range = findPathRange(doc, ['a']);
    expect(doc.substr(range.offset, range.length)).toBe('2');
  });

  test('extremely deep text degrades to no mapping instead of throwing', () => {
    const deep = '['.repeat(20000) + ']'.repeat(20000);
    expect(findPathRange(deep, [0])).toBeNull();
    expect(getPathAtOffset(deep, 10000)).toBeNull();
  });
});

describe('stats and formatting helpers', () => {
  test('computeStats counts every value type and depth', () => {
    const stats = computeStats({ a: [1, 'x', null, { b: true }], c: {} });
    expect(stats).toMatchObject({
      objects: 3,
      arrays: 1,
      strings: 1,
      numbers: 1,
      booleans: 1,
      nulls: 1,
      keys: 3,
      maxDepth: 3,
      values: 8,
    });
    expect(computeStats(5)).toMatchObject({ numbers: 1, maxDepth: 0, values: 1 });
  });

  test('getValueType distinguishes arrays and null', () => {
    expect([null, [], {}, 'a', 1, false].map(getValueType)).toEqual(['null', 'array', 'object', 'string', 'number', 'boolean']);
  });

  test('previewValue summarises containers', () => {
    expect(previewValue({ a: 1, b: 2 })).toBe('{2 keys}');
    expect(previewValue([1])).toBe('[1 item]');
    expect(previewValue('hi')).toBe('"hi"');
    expect(previewValue('x'.repeat(100), 10)).toBe('"xxxxxxxx…');
  });

  test('utf8ByteLength counts UTF-8 bytes like TextEncoder', () => {
    // 1 (a) + 2 (é) + 3 (€) + 4 (👋) + 3 (lone surrogate → U+FFFD)
    expect(utf8ByteLength('aé€👋\ud800')).toBe(13);
  });

  test('truncation never splits a surrogate pair', () => {
    expect(sliceText('a😀b', 2)).toBe('a');
    expect(sliceText('a😀b', 3)).toBe('a😀');
    expect(truncate('😀😀😀', 4)).toBe('😀…');
  });

  test('formatBytes picks a readable unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
