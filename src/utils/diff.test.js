import { diffJson } from './diff';
import { parseJson, RawNumber } from './json';

const summarize = (result) => result.changes.map((change) => [change.kind, JSON.stringify(change.path)]);

describe('diffJson', () => {
  test('identical values have no changes, regardless of key order', () => {
    const result = diffJson({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 });
    expect(result).toMatchObject({ total: 0, changes: [], truncated: false });
  });

  test('reports added, removed and changed properties', () => {
    const result = diffJson({ keep: 1, drop: true, edit: 'old', nested: { x: 1 } }, { keep: 1, edit: 'new', nested: { x: 2 }, extra: null });
    expect(summarize(result)).toEqual([
      ['removed', '["drop"]'],
      ['changed', '["edit"]'],
      ['changed', '["nested","x"]'],
      ['added', '["extra"]'],
    ]);
    expect(result.counts).toEqual({ added: 1, removed: 1, changed: 2, moved: 0 });
    expect(result.changes[1]).toMatchObject({ before: 'old', after: 'new' });
  });

  test('flags type changes', () => {
    const [change] = diffJson({ v: 1 }, { v: '1' }).changes;
    expect(change).toMatchObject({ kind: 'changed', typeChanged: true, before: 1, after: '1' });
    expect(diffJson([1], { 0: 1 }).changes[0]).toMatchObject({ kind: 'changed', path: [], typeChanged: true });
  });

  test('aligns arrays so a single insertion is a single change', () => {
    const before = ['a', 'b', 'c', 'd'];
    const after = ['a', 'x', 'b', 'c', 'd'];
    expect(summarize(diffJson(before, after))).toEqual([['added', '[1]']]);
    expect(summarize(diffJson(after, before))).toEqual([['removed', '[1]']]);
  });

  test('pairs replaced array items as in-place changes', () => {
    expect(summarize(diffJson([1, 2, 3], [1, 5, 3]))).toEqual([['changed', '[1]']]);
    expect(summarize(diffJson([{ v: 1 }, { v: 2 }], [{ v: 1 }, { v: 3 }]))).toEqual([['changed', '[1,"v"]']]);
  });

  test('matches objects by id so edits and removals are precise', () => {
    const before = [
      { id: 1, name: 'Ada', role: 'admin' },
      { id: 2, name: 'Alan' },
      { id: 3, name: 'Grace' },
    ];
    const after = [
      { id: 1, name: 'Ada', role: 'owner' },
      { id: 3, name: 'Grace' },
    ];
    const result = diffJson(before, after);
    expect(summarize(result)).toEqual([
      ['changed', '[0,"role"]'],
      ['removed', '[1]'],
    ]);
    expect(result.changes[1]).toMatchObject({ leftPath: [1], rightPath: null, before: { id: 2, name: 'Alan' } });
  });

  test('tracks separate left and right paths when indices shift', () => {
    const result = diffJson([{ id: 'x', v: 1 }, { id: 'y', v: 1 }], [{ id: 'new' }, { id: 'x', v: 1 }, { id: 'y', v: 2 }]);
    expect(result.changes).toEqual([
      { kind: 'added', path: [0], leftPath: null, rightPath: [0], after: { id: 'new' } },
      { kind: 'changed', path: [2, 'v'], leftPath: [1, 'v'], rightPath: [2, 'v'], before: 1, after: 2 },
    ]);
  });

  test('reports items that moved, with the edits inside them', () => {
    const result = diffJson([{ id: 1, v: 'a' }, { id: 2 }, { id: 3 }], [{ id: 2 }, { id: 3 }, { id: 1, v: 'A' }]);
    expect(result.changes).toEqual([
      { kind: 'moved', path: [2], leftPath: [0], rightPath: [2], before: { id: 1, v: 'a' }, after: { id: 1, v: 'A' } },
      { kind: 'changed', path: [2, 'v'], leftPath: [0, 'v'], rightPath: [2, 'v'], before: 'a', after: 'A' },
    ]);
    expect(result).toMatchObject({ counts: { added: 0, removed: 0, changed: 1, moved: 1 }, total: 2 });
    // Values without ids move too, and as few items as possible are reported as moved.
    expect(summarize(diffJson([1, 2, 3], [3, 1, 2]))).toEqual([['moved', '[0]']]);
    expect(summarize(diffJson([0, 1, 0, 1], [1, 0, 1, 0]))).toHaveLength(1);
    expect(summarize(diffJson(['a', 'b', 'a'], ['a', 'a', 'b']))).toHaveLength(1);
    // Position by position nothing moves, and unordered a move is not a difference.
    expect(summarize(diffJson([1, 2], [2, 1], { arrays: 'index' }))).toEqual([
      ['changed', '[0]'],
      ['changed', '[1]'],
    ]);
    expect(diffJson([3, 1, 2], [1, 2, 3], { arrays: 'unordered' }).total).toBe(0);
    expect(diffJson([{ id: 1, v: 'a' }, { id: 2 }], [{ id: 2 }, { id: 1, v: 'b' }], { arrays: 'unordered' }).changes).toEqual([
      { kind: 'changed', path: [1, 'v'], leftPath: [0, 'v'], rightPath: [1, 'v'], before: 'a', after: 'b' },
    ]);
  });

  test('matches records by keys such as productId, and treats a new name as an edit', () => {
    const before = [
      { productId: 'TS-1', name: 'Mouse', price: 10 },
      { productId: 'TS-2', name: 'Keyboard' },
    ];
    const after = [
      { productId: 'TS-1', name: 'Mouse Pro', price: 12 },
      { productId: 'TS-3', name: 'Hub' },
    ];
    expect(summarize(diffJson(before, after))).toEqual([
      ['changed', '[0,"name"]'],
      ['changed', '[0,"price"]'],
      ['removed', '[1]'],
      ['added', '[1]'],
    ]);
    // Names identify items too, but a renamed item is still the same item.
    expect(summarize(diffJson([{ name: 'a', v: 1 }, { name: 'b' }], [{ name: 'a', v: 1 }, { name: 'c' }]))).toEqual([['changed', '[1,"name"]']]);
    expect(summarize(diffJson([{ name: 'b' }, { name: 'a' }], [{ name: 'a' }, { name: 'b' }]))).toEqual([['moved', '[1]']]);
  });

  test('never pairs two different records as an edit', () => {
    expect(summarize(diffJson([{ id: 1 }, { id: 2, v: 1 }, { id: 3 }], [{ id: 1 }, { id: 5, v: 1 }, { id: 3 }]))).toEqual([
      ['removed', '[1]'],
      ['added', '[1]'],
    ]);
    // An item without an id facing a changed one is edited in place, even next to a record with an id.
    expect(summarize(diffJson([{ id: 1 }, { v: 1 }, { id: 2 }], [{ id: 1 }, { v: 2 }, { id: 3 }]))).toEqual([
      ['changed', '[1,"v"]'],
      ['removed', '[2]'],
      ['added', '[2]'],
    ]);
    // Ids compare by exact value and type: the number 5 and the string "5" are different records.
    expect(summarize(diffJson([{ id: 5 }], [{ id: '5' }]))).toEqual([
      ['removed', '[0]'],
      ['added', '[0]'],
    ]);
  });

  test('aligns long arrays exactly when few items differ', () => {
    const values = Array.from({ length: 5000 }, (_, index) => index % 7);
    expect(diffJson(values, [...values.slice(1), values[0]]).changes).toEqual([{ kind: 'moved', path: [4999], leftPath: [0], rightPath: [4999], before: 0, after: 0 }]);
    const inserted = [9, ...values.slice(0, 2500), 8, ...values.slice(2500), 7];
    expect(summarize(diffJson(values, inserted))).toEqual([
      ['added', '[0]'],
      ['added', '[2501]'],
      ['added', '[5002]'],
    ]);
  });

  test('aligns arrays that differ in thousands of places by identity', () => {
    // Every other record is replaced, so the edit script is too long for Myers' algorithm.
    const before = Array.from({ length: 6000 }, (_, id) => ({ id, v: id }));
    const after = before.map((item) => (item.id % 2 ? { id: `new-${item.id}` } : item));
    after.push(after.shift());
    after[21] = { id: 22, v: 'edited' };
    const result = diffJson(before, after, { limit: Infinity });
    expect(result.counts).toEqual({ added: 3000, removed: 3000, changed: 1, moved: 1 });
    expect(result.changes.find((change) => change.kind === 'changed')).toMatchObject({ leftPath: [22, 'v'], rightPath: [21, 'v'] });
    expect(result.changes.find((change) => change.kind === 'moved')).toMatchObject({ leftPath: [0], rightPath: [5999] });
    // A common start and end stay paired.
    const middle = (offset) => Array.from({ length: 1500 }, (_, index) => ({ id: `${offset}-${index}` }));
    const framed = diffJson([{ id: 'first' }, ...middle('a'), { id: 'last' }], [{ id: 'first' }, ...middle('b'), { id: 'last' }], { limit: Infinity });
    expect(framed.counts).toEqual({ added: 1500, removed: 1500, changed: 0, moved: 0 });
    const appended = Array.from({ length: 3000 }, (_, index) => index);
    expect(diffJson(['x'], ['x', ...appended]).counts.added).toBe(3000);
    // Repeated values pair up by occurrence.
    const values = Array.from({ length: 6000 }, (_, index) => [index % 3, index][index % 2]);
    expect(diffJson(values, [...values].reverse()).counts.moved).toBeGreaterThan(0);
  });

  test('pairs repeated and nested values consistently', () => {
    // Two equal items on the left, one on the right: one of them moves, the other is removed.
    expect(diffJson(['k', 'k', 'x'], ['x', 'k']).counts).toEqual({ added: 0, removed: 1, changed: 0, moved: 1 });
    // Nested arrays of objects are compared item by item.
    expect(summarize(diffJson([[{ a: 1 }], [{ b: 1 }, { c: 1 }]], [[{ a: 1 }], [{ b: 2 }, { c: 1 }]]))).toEqual([['changed', '[1,0,"b"]']]);
    // Long arrays with nothing in common are compared place by place.
    const left = Array.from({ length: 3000 }, (_, index) => index);
    expect(diffJson(left, left.map((value) => value + 3000), { limit: Infinity }).counts).toEqual({ added: 0, removed: 0, changed: 3000, moved: 0 });
  });

  test('caps the stored change list but keeps accurate counts', () => {
    const before = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]));
    const after = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i + 1]));
    const result = diffJson(before, after, { limit: 10 });
    expect(result.changes).toHaveLength(10);
    expect(result.total).toBe(50);
    expect(result.truncated).toBe(true);
  });

  test('handles primitive roots', () => {
    expect(summarize(diffJson('a', 'b'))).toEqual([['changed', '[]']]);
    expect(diffJson(null, null).total).toBe(0);
  });

  test('exact parses tell apart integers that JavaScript numbers would round together', () => {
    const left = '{"id": 1234567890123456789, "list": [{"id": 1234567890123456789, "v": 1}]}';
    const right = '{"id": 1234567890123456788, "list": [{"id": 1234567890123456789, "v": 2}]}';
    expect(diffJson(parseJson(left).value, parseJson(right).value).total).toBe(1);
    const exact = diffJson(parseJson(left, { exact: true }).value, parseJson(right, { exact: true }).value);
    expect(summarize(exact)).toEqual([
      ['changed', '["id"]'],
      ['changed', '["list",0,"v"]'],
    ]);
    // A large integer against a regular number is a changed value, not a type change.
    expect(diffJson({ n: new RawNumber('12345678901234567890') }, { n: 5 }).changes[0].typeChanged).toBeUndefined();
    // Numbers compare by value, not spelling; array items are matched the same way.
    expect(diffJson({ n: new RawNumber('1.50'), list: [new RawNumber('1e2'), 3] }, { n: 1.5, list: [100, 3] }).total).toBe(0);
    expect(diffJson([{ id: new RawNumber('12345678901234567890'), v: 1 }], [{ id: new RawNumber('12345678901234567890'), v: 2 }]).changes[0].path).toEqual([0, 'v']);
  });
});
