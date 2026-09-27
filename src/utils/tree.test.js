import { computeExpansion, flattenTree, previewContainer, rowPath, searchTree, TREE_MAX_EXPAND_DEPTH, TREE_ROOT_ID } from './tree';

describe('tree', () => {
  const doc = { a: { b: [1, { c: 2 }] }, 'x/y': 3, '': { z: null } };

  test('flattens the expanded part of the document in order', () => {
    const rows = flattenTree(doc, computeExpansion(doc));
    expect(rows.map((row) => row.id)).toEqual(['$', '$/a', '$/a/b', '$/a/b/0', '$/a/b/1', '$/a/b/1/c', '$/x~1y', '$/', '$//z']);
    expect(rowPath(rows, 5)).toEqual(['a', 'b', 1, 'c']);
    expect(rowPath(rows, 8)).toEqual(['', 'z']);
  });

  test('searchTree finds keys and primitive values', () => {
    expect(searchTree(doc, 'C')).toEqual(['$/a/b/1/c']);
    expect(searchTree(doc, 'null')).toEqual(['$//z']);
  });

  test('automatic expansion stops at a maximum depth, bounding id sizes', () => {
    const depth = TREE_MAX_EXPAND_DEPTH * 4;
    const deep = JSON.parse('{"k":'.repeat(depth) + '1' + '}'.repeat(depth));
    const expanded = computeExpansion(deep, 50000);
    expect(expanded.size).toBe(TREE_MAX_EXPAND_DEPTH);
    expect(flattenTree(deep, expanded)).toHaveLength(TREE_MAX_EXPAND_DEPTH + 1);
    expect(expanded.has(TREE_ROOT_ID)).toBe(true);
  });

  test('previews collapsed containers without splitting characters', () => {
    expect(previewContainer({ id: 1, name: 'Ada' })).toBe('{ id: 1, name: "Ada" }');
    expect(previewContainer([1, 'two', [3], {}])).toBe('[1, "two", […], {}]');
    const long = previewContainer({ k: '😀'.repeat(30) });
    expect(long).toBe(`{ k: "${'😀'.repeat(11)}…" }`);
    expect(previewContainer(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`key${i}`, i])), 30)).toBe(
      '{ key0: 0, key1: 1, key2: 2, … }'
    );
  });
});
