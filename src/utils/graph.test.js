import {
  AUTO_EXPAND_BUDGET,
  CHILD_PAGE_SIZE,
  MAX_GRAPH_DEPTH,
  MAX_ROWS,
  ROOT_ID,
  buildFlowGraph,
  buildGraphModel,
  computeVisibility,
  findNodeForPath,
  getLineage,
  getNeighborNode,
  getNodePath,
  getNodeView,
  moreNodeId,
  revealNode,
  searchModel,
} from './graph';

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function expectNoOverlaps(nodes) {
  const rects = nodes.map((node) => ({ id: node.id, ...node.position, ...node.style }));
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (rectsOverlap(rects[i], rects[j])) {
        throw new Error(`Nodes overlap: ${rects[i].id} and ${rects[j].id}`);
      }
    }
  }
}

const catalog = {
  catalog: {
    storeName: 'TechStuff',
    products: [
      { productId: 'TS-1', name: 'Mouse', tags: ['a', 'b'], specs: { color: 'black' } },
      { productId: 'TS-2', name: 'Keyboard', tags: [], specs: { color: 'white' } },
    ],
    promotions: { active: true, details: { discount: 15 } },
  },
};

describe('buildGraphModel', () => {
  test('creates one node per non-inline container with pointer ids', () => {
    const model = buildGraphModel(catalog);
    const documentOrder = [
      '$',
      '$/catalog',
      '$/catalog/products',
      '$/catalog/products/0',
      '$/catalog/products/0/specs',
      '$/catalog/products/1',
      '$/catalog/products/1/specs',
      '$/catalog/promotions',
      '$/catalog/promotions/details',
    ];
    expect(model.order).toEqual(documentOrder);
    expect(new Set(model.nodes.keys())).toEqual(new Set(documentOrder));
  });

  test('never produces colliding ids for tricky keys', () => {
    const model = buildGraphModel({ a_b: { x: 1 }, a: { b: { y: 2 } }, 'c/d': { z: 3 }, 'e~1': { w: 4 } });
    const ids = [...model.nodes.keys()];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['$/a_b', '$/a/b', '$/c~1d', '$/e~01']));
  });

  test('renders primitives, empty containers and short primitive arrays as rows', () => {
    const model = buildGraphModel({ n: 1, s: 'x', b: false, z: null, e: {}, l: [], t: [1, 2, 3], obj: { k: 1 } });
    const view = getNodeView(model.nodes.get(ROOT_ID));
    expect(view.rows.map((row) => [row.keyText, row.text, row.kind])).toEqual([
      ['n', '1', 'number'],
      ['s', '"x"', 'string'],
      ['b', 'false', 'boolean'],
      ['z', 'null', 'null'],
      ['e', '{}', 'empty'],
      ['l', '[]', 'empty'],
      ['t', '[1, 2, 3]', 'array'],
    ]);
    expect(view.chip).toBe('{8}');
    expect(model.nodes.get(ROOT_ID).childIds).toEqual(['$/obj']);
  });

  test('handles mixed and nested arrays without dropping data', () => {
    const model = buildGraphModel([1, 'two', { three: 3 }, [4, 5], Array.from({ length: 12 }, (_, i) => i)]);
    const root = model.nodes.get(ROOT_ID);
    expect(getNodeView(root).rows.map((row) => row.keyText)).toEqual(['[0]', '[1]', '[3]']);
    expect(root.childIds).toEqual(['$/2', '$/4']);
    expect(getNodeView(model.nodes.get('$/4')).rows).toHaveLength(12);
    expect(getNodeView(model.nodes.get('$/2')).label).toBe('[2]');
  });

  test('supports primitive documents', () => {
    const model = buildGraphModel('hello');
    const view = getNodeView(model.nodes.get(ROOT_ID));
    expect(view).toMatchObject({ kind: 'value', label: 'root', text: '"hello"', valueKind: 'string' });
  });

  test('labels array items with a readable hint', () => {
    const model = buildGraphModel({ users: [{ id: 7, name: 'Ada' }, { id: 8 }, { other: true, nested: {} }] });
    expect(getNodeView(model.nodes.get('$/users/0'))).toMatchObject({ label: '[0]', hint: 'Ada' });
    expect(getNodeView(model.nodes.get('$/users/1'))).toMatchObject({ label: '[1]', hint: '8' });
    expect(getNodeView(model.nodes.get('$/users/2')).hint).toBeNull();
  });

  test('caps rows per node and reports how many are hidden', () => {
    const wide = Object.fromEntries(Array.from({ length: MAX_ROWS + 7 }, (_, i) => [`k${i}`, i]));
    const view = getNodeView(buildGraphModel(wide).nodes.get(ROOT_ID));
    expect(view.rows).toHaveLength(MAX_ROWS);
    expect(view.hiddenRows).toBe(7);
  });

  test('stops creating nodes past the maximum depth and shows deeper values as rows', () => {
    const deep = {};
    let cursor = deep;
    for (let level = 0; level < MAX_GRAPH_DEPTH + 40; level += 1) {
      cursor.next = { level, list: [{ x: 1 }] };
      cursor = cursor.next;
    }
    const model = buildGraphModel(deep);
    expect(Math.max(...[...model.nodes.values()].map((node) => node.depth))).toBe(MAX_GRAPH_DEPTH);
    const deepest = model.nodes.get(ROOT_ID + '/next'.repeat(MAX_GRAPH_DEPTH));
    expect(getNodeView(deepest).rows.map((row) => [row.keyText, row.text, row.kind])).toEqual([
      ['level', String(MAX_GRAPH_DEPTH - 1), 'number'],
      ['list', '[…]', 'deep'],
      ['next', '{…}', 'deep'],
    ]);
  });

  test('maps paths to nodes and rows', () => {
    const model = buildGraphModel(catalog);
    expect(getNodePath(model, '$/catalog/products/1/specs')).toEqual(['catalog', 'products', 1, 'specs']);
    expect(findNodeForPath(model, ['catalog', 'products', 0, 'name'])).toEqual({ nodeId: '$/catalog/products/0', rowKey: 'name' });
    expect(findNodeForPath(model, ['catalog', 'products', 0, 'tags', 1])).toEqual({ nodeId: '$/catalog/products/0', rowKey: 'tags' });
    expect(findNodeForPath(model, ['catalog', 'promotions'])).toEqual({ nodeId: '$/catalog/promotions', rowKey: null });
    expect(findNodeForPath(model, [])).toEqual({ nodeId: ROOT_ID, rowKey: null });
  });
});

describe('visibility', () => {
  const records = { items: Array.from({ length: 180 }, (_, i) => ({ id: i, meta: { a: i }, more: { b: i } })) };

  test('small documents are fully expanded', () => {
    const { collapsedIds, visibleCount } = computeVisibility(buildGraphModel(catalog));
    expect(collapsedIds.size).toBe(0);
    expect(visibleCount).toBe(9);
  });

  test('pages wide nodes and stays within the auto-expand budget', () => {
    const model = buildGraphModel(records);
    const { childrenOf, stubs, visibleCount } = computeVisibility(model);
    const itemChildren = childrenOf.get('$/items');
    expect(itemChildren).toHaveLength(CHILD_PAGE_SIZE + 1);
    expect(itemChildren[CHILD_PAGE_SIZE]).toBe(moreNodeId('$/items'));
    expect(stubs.get(moreNodeId('$/items'))).toEqual({ parentId: '$/items', shown: CHILD_PAGE_SIZE, remaining: 130 });
    expect(visibleCount).toBeLessThanOrEqual(AUTO_EXPAND_BUDGET);
  });

  test('auto-collapse expands breadth-first as a clean prefix', () => {
    // 10 groups × 20 children fit in the budget; the 200 grandchildren do not.
    const wide = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`g${i}`, Object.fromEntries(Array.from({ length: 20 }, (__, j) => [`c${j}`, { v: j, w: { x: 1 } }]))])
    );
    const model = buildGraphModel(wide);
    const { collapsedIds, visibleCount } = computeVisibility(model);
    expect(visibleCount).toBeLessThanOrEqual(AUTO_EXPAND_BUDGET);
    for (let i = 0; i < 10; i += 1) expect(collapsedIds.has(`$/g${i}`)).toBe(false);
    // Once the budget runs out, every later node in breadth-first order stays collapsed.
    const bfsOrder = model.order.filter((id) => id.split('/').length === 3);
    const firstCollapsed = bfsOrder.findIndex((id) => collapsedIds.has(id));
    expect(firstCollapsed).toBeGreaterThan(0);
    bfsOrder.slice(firstCollapsed).forEach((id) => expect(collapsedIds.has(id)).toBe(true));
  });

  test('explicit toggles and modes override the defaults', () => {
    const model = buildGraphModel(catalog);
    const collapsedAll = computeVisibility(model, { mode: 'collapsed' });
    expect(collapsedAll.childrenOf.get(ROOT_ID)).toEqual(['$/catalog']);
    expect(collapsedAll.collapsedIds.has('$/catalog')).toBe(true);

    const toggled = computeVisibility(model, { expansion: new Map([['$/catalog/products', false]]) });
    expect(toggled.collapsedIds).toEqual(new Set(['$/catalog/products']));
    expect(toggled.childrenOf.has('$/catalog/products')).toBe(false);

    const paged = computeVisibility(buildGraphModel(records), { pageSizes: new Map([['$/items', 200]]) });
    expect(paged.stubs.size).toBe(0);
  });

  test('revealNode expands ancestors and pages far-away children into view', () => {
    const model = buildGraphModel(records);
    const target = '$/items/150/meta';
    const { expansion, pageSizes } = revealNode(model, target, new Map([['$/items', false]]), new Map());
    expect(expansion.get('$/items')).toBe(true);
    expect(expansion.get('$/items/150')).toBe(true);
    expect(pageSizes.get('$/items')).toBe(200);
    const graph = buildFlowGraph(model, { expansion, pageSizes });
    expect(graph.order).toContain(target);
  });
});

describe('buildFlowGraph', () => {
  test.each(['LR', 'TB'])('lays out %s without overlaps or dangling edges', (direction) => {
    const data = {
      ...catalog,
      list: Array.from({ length: 70 }, (_, i) => ({ i, child: { deep: { deeper: i } } })),
      matrix: [[1, 2], [3, [4, 5]], { k: [1, { z: 1 }] }],
    };
    const graph = buildFlowGraph(buildGraphModel(data), { direction });
    const ids = new Set(graph.nodes.map((node) => node.id));
    expect(ids.size).toBe(graph.nodes.length);
    graph.edges.forEach((edge) => {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    });
    expect(graph.edges).toHaveLength(graph.nodes.length - 1);
    expectNoOverlaps(graph.nodes);
  });

  test('children sit beyond their parent on the main axis and parents are centred', () => {
    const graph = buildFlowGraph(buildGraphModel(catalog));
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    graph.edges.forEach(({ source, target }) => {
      const parent = byId.get(source);
      const child = byId.get(target);
      expect(child.position.x).toBeGreaterThan(parent.position.x + parent.style.width);
    });
    const products = byId.get('$/catalog/products');
    const first = byId.get('$/catalog/products/0');
    const last = byId.get('$/catalog/products/1');
    const childrenCentre = (first.position.y + last.position.y + last.style.height) / 2;
    expect(products.position.y + products.style.height / 2).toBeCloseTo(childrenCentre, 5);
  });

  test('marks collapsed nodes and uses direction-specific handles', () => {
    const graph = buildFlowGraph(buildGraphModel(catalog), {
      direction: 'TB',
      expansion: new Map([['$/catalog/promotions', false]]),
    });
    const promotions = graph.nodes.find((node) => node.id === '$/catalog/promotions');
    expect(promotions.data.collapsed).toBe(true);
    expect(promotions.data.childCount).toBe(1);
    expect(promotions).toMatchObject({ sourcePosition: 'bottom', targetPosition: 'top' });
    expect(graph.order).not.toContain('$/catalog/promotions/details');
  });

  test('reuses node data objects when nothing about a node changed', () => {
    const model = buildGraphModel(catalog);
    const first = buildFlowGraph(model);
    const second = buildFlowGraph(model, { expansion: new Map([['$/catalog/promotions', false]]) });
    const dataOf = (graph, id) => graph.nodes.find((node) => node.id === id).data;
    expect(dataOf(second, '$/catalog')).toBe(dataOf(first, '$/catalog'));
    expect(dataOf(second, '$/catalog/promotions')).not.toBe(dataOf(first, '$/catalog/promotions'));
  });
});

describe('search and navigation', () => {
  const model = buildGraphModel(catalog);

  test('searchModel matches keys and inline values, case-insensitively, in document order', () => {
    expect(searchModel(model, 'black')).toEqual(['$/catalog/products/0/specs']);
    expect(searchModel(model, 'SPECS')).toEqual(['$/catalog/products/0/specs', '$/catalog/products/1/specs']);
    expect(searchModel(model, 'b')).toEqual(expect.arrayContaining(['$/catalog/products/0']));
    expect(searchModel(model, '15')).toEqual(['$/catalog/promotions/details']);
    expect(searchModel(model, '   ')).toEqual([]);
    expect(searchModel(model, 'nothing-matches')).toEqual([]);
  });

  test('getLineage walks from the node back to the root', () => {
    const graph = buildFlowGraph(model);
    expect(getLineage(graph.parentOf, '$/catalog/products/1/specs')).toEqual({
      nodeIds: ['$/catalog/products/1/specs', '$/catalog/products/1', '$/catalog/products', '$/catalog', '$'],
      edgeIds: ['e:$/catalog/products/1/specs', 'e:$/catalog/products/1', 'e:$/catalog/products', 'e:$/catalog'],
    });
  });

  test('getNeighborNode moves between parent, children and siblings', () => {
    const graph = buildFlowGraph(model);
    expect(getNeighborNode(graph, '$/catalog/products', 'parent')).toBe('$/catalog');
    expect(getNeighborNode(graph, '$/catalog/products', 'child')).toBe('$/catalog/products/0');
    expect(getNeighborNode(graph, '$/catalog/products', 'next')).toBe('$/catalog/promotions');
    expect(getNeighborNode(graph, '$/catalog/promotions', 'prev')).toBe('$/catalog/products');
    expect(getNeighborNode(graph, '$/catalog/promotions', 'next')).toBeNull();
    expect(getNeighborNode(graph, ROOT_ID, 'parent')).toBeNull();
  });
});
