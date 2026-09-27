import { diffJson } from './diff';

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
    expect(result.counts).toEqual({ added: 1, removed: 1, changed: 2 });
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
});
