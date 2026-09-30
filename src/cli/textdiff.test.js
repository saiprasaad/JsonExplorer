/** @jest-environment node */
import { changeSnippets, countChanges, diffSequences, unifiedDiff } from './textdiff';

/** Applies an edit script to `a`, which must give `b`. */
function apply(ops, a, b) {
  const out = [];
  ops.forEach((op) => {
    if (op.type === 'equal') out.push(...a.slice(op.a, op.a + op.count));
    if (op.type === 'insert') out.push(...b.slice(op.b, op.b + op.count));
  });
  return out;
}

describe('diffSequences', () => {
  it('returns one equal run for identical sequences, and nothing for two empty ones', () => {
    expect(diffSequences(['a', 'b'], ['a', 'b'])).toEqual([{ type: 'equal', a: 0, b: 0, count: 2 }]);
    expect(diffSequences([], [])).toEqual([]);
  });

  it('finds insertions, deletions and replacements', () => {
    expect(diffSequences(['a', 'c'], ['a', 'b', 'c'])).toEqual([
      { type: 'equal', a: 0, b: 0, count: 1 },
      { type: 'insert', a: 1, b: 1, count: 1 },
      { type: 'equal', a: 1, b: 2, count: 1 },
    ]);
    expect(diffSequences(['a', 'b', 'c'], ['a', 'c'])).toEqual([
      { type: 'equal', a: 0, b: 0, count: 1 },
      { type: 'delete', a: 1, b: 1, count: 1 },
      { type: 'equal', a: 2, b: 1, count: 1 },
    ]);
    expect(diffSequences(['x'], ['y'])).toEqual([
      { type: 'delete', a: 0, b: 0, count: 1 },
      { type: 'insert', a: 1, b: 0, count: 1 },
    ]);
    expect(diffSequences([], ['a', 'b'])).toEqual([{ type: 'insert', a: 0, b: 0, count: 2 }]);
  });

  it('produces scripts that turn a into b', () => {
    const cases = [
      ['abcabba', 'cbabac'],
      ['kitten', 'sitting'],
      ['', 'abc'],
      ['abc', ''],
      ['the quick brown fox', 'the quack brown box!'],
    ];
    cases.forEach(([left, right]) => {
      const a = [...left];
      const b = [...right];
      expect(apply(diffSequences(a, b), a, b).join('')).toBe(right);
    });
  });

  it('gives up when the sequences differ in more places than allowed', () => {
    expect(diffSequences([...'abcdef'], [...'uvwxyz'], 3)).toBeNull();
    expect(diffSequences([...'abcdef'], [...'uvwxyz'], 12)).not.toBeNull();
  });
});

describe('unifiedDiff', () => {
  it('is empty when nothing changed', () => {
    expect(unifiedDiff('a\nb', 'a\nb')).toBe('');
  });

  it('writes hunks with context and headers', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].join('\n');
    const after = ['1', '2', 'three', '4', '5', '6', '7', '8', '9', '10', '11', 'twelve'].join('\n');
    expect(unifiedDiff(before, after, { from: 'a.json', to: 'b.json', context: 1 })).toBe(
      ['--- a.json', '+++ b.json', '@@ -2,3 +2,3 @@', ' 2', '-3', '+three', ' 4', '@@ -11,2 +11,2 @@', ' 11', '-12', '+twelve'].join('\n')
    );
  });

  it('merges changes whose context lines touch, like diff -u, and uses default labels', () => {
    expect(unifiedDiff('a\nb\nc\nd', 'A\nb\nc\nD', { context: 1 })).toBe(['--- original', '+++ changed', '@@ -1,4 +1,4 @@', '-a', '+A', ' b', ' c', '-d', '+D'].join('\n'));
    expect(unifiedDiff('a\nb\nc\nd\ne', 'A\nb\nc\nd\nE', { context: 1 })).toBe(
      ['--- original', '+++ changed', '@@ -1,2 +1,2 @@', '-a', '+A', ' b', '@@ -4,2 +4,2 @@', ' d', '-e', '+E'].join('\n')
    );
  });

  it('numbers empty ranges like diff -u', () => {
    expect(unifiedDiff('', 'x\ny', { context: 0 })).toBe(['--- original', '+++ changed', '@@ -1,1 +1,2 @@', '-', '+x', '+y'].join('\n'));
    expect(unifiedDiff('a\nb', 'a\nb\nc', { context: 0 })).toBe(['--- original', '+++ changed', '@@ -2,0 +3,1 @@', '+c'].join('\n'));
    expect(unifiedDiff('a\nb\nc', 'a\nc', { context: 0 })).toBe(['--- original', '+++ changed', '@@ -2,1 +1,0 @@', '-b'].join('\n'));
  });

  it('treats CRLF and LF line breaks alike', () => {
    expect(unifiedDiff('a\r\nb', 'a\nb')).toBe('');
  });

  it('returns null when the texts differ too much', () => {
    expect(unifiedDiff('a\nb\nc', 'x\ny\nz', { maxEdits: 2 })).toBeNull();
  });
});

describe('countChanges', () => {
  it('counts separate runs of token changes', () => {
    expect(countChanges('{"a": 1, "b": 2}', '{"a": 1, "b": 2}')).toBe(0);
    expect(countChanges("{'a': 1, b: 2,}", '{"a": 1, "b": 2}')).toBe(3);
    expect(countChanges('', 'x')).toBe(1);
    expect(countChanges('x', '')).toBe(1);
    expect(countChanges('[1,2,3,4,5,6,7,8,9]', 'null', 2)).toBeNull();
  });
});

describe('changeSnippets', () => {
  it('shows each change with context and its position', () => {
    const before = `{"name": 'Ada', ${'"pad": 0, '.repeat(10)}"ok": True}`;
    const after = `{"name": "Ada", ${'"pad": 0, '.repeat(10)}"ok": true}`;
    const text = changeSnippets(before, after, { context: 8 });
    expect(text).toBe(
      [
        'line 1, column 10:',
        `  - …"name": 'Ada', "pad":…`,
        `  + …"name": "Ada", "pad":…`,
        'line 1, column 123:',
        '  - …, "ok": True}',
        '  + …, "ok": true}',
      ].join('\n')
    );
  });

  it('shows changes close together as one place', () => {
    expect(changeSnippets("{'a': 1}", '{"a": 1}')).toBe(['line 1, column 2:', `  - {'a': 1}`, '  + {"a": 1}'].join('\n'));
    expect(changeSnippets("{'a': 'b'}", '{"a": "b"}')).toBe(['line 1, column 2:', `  - {'a': 'b'}`, '  + {"a": "b"}'].join('\n'));
  });

  it('reports positions on later lines and collapses whitespace', () => {
    expect(changeSnippets('[\n  1,\n  2,\n]', '[\n  1,\n  2\n]', { context: 3 })).toBe(['line 3, column 4:', '  - … 2, ]', '  + … 2 ]'].join('\n'));
  });

  it('limits the number of places shown', () => {
    const before = Array.from({ length: 5 }, (_, i) => `'k${i}'`).join(`, ${'x'.repeat(60)}, `);
    const after = before.replace(/'/g, '"');
    const text = changeSnippets(before, after, { context: 4, maxChanges: 2 });
    expect(text.split('\n').filter((line) => line.startsWith('line '))).toHaveLength(2);
    expect(text.endsWith('\n… 3 more places changed')).toBe(true);
  });

  it('handles empty texts', () => {
    expect(changeSnippets('', '[]')).toBe('line 1, column 1:\n  - \n  + []');
    expect(changeSnippets('[]', '')).toBe('line 1, column 1:\n  - []\n  + ');
  });

  it('returns null when the texts differ too much', () => {
    expect(changeSnippets('[1,2,3,4,5,6,7,8,9]', 'null', { maxEdits: 2 })).toBeNull();
  });
});
