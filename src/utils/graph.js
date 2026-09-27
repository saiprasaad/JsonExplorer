import { isContainer } from './json';

/*
 * Graph model
 * ───────────
 * Every object/array that is not rendered inline becomes a node. Primitive properties, empty
 * containers and short arrays of primitives render as rows inside their parent node. Node ids
 * are `$` + the RFC 6901 JSON Pointer of the value, so they are unique and stable across edits.
 */

export const ROOT_ID = '$';
export const CHILD_PAGE_SIZE = 50;
export const MAX_ROWS = 50;
export const INLINE_ARRAY_MAX = 10;
export const AUTO_EXPAND_BUDGET = 400;
export const EXPAND_ALL_BUDGET = 2500;
// Deeper containers render as `{…}` rows; pointer ids grow with depth, so this bounds memory.
export const MAX_GRAPH_DEPTH = 256;
const MAX_ROW_TEXT = 160;

export const NODE_METRICS = {
  headerHeight: 32,
  rowHeight: 20,
  paddingX: 12,
  paddingY: 6,
  minWidth: 140,
  maxWidth: 360,
  gapMain: 72,
  gapCross: 18,
  gapMainVertical: 56,
  gapCrossVertical: 24,
  moreWidth: 210,
  moreHeight: 62,
};

const NAME_KEYS = ['name', 'title', 'label', 'displayName', 'username', 'id', '_id', 'key', 'slug', 'code', 'sku', 'email'];
const EMPTY = Object.freeze([]);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export const moreNodeId = (parentId) => `more:${parentId}`;

export function childNodeId(parentId, key) {
  return `${parentId}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function hasOwnKeys(object) {
  for (const key in object) {
    if (hasOwn(object, key)) return true;
  }
  return false;
}

export function isInlineValue(value) {
  if (!isContainer(value)) return true;
  if (Array.isArray(value)) {
    if (value.length > INLINE_ARRAY_MAX) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (isContainer(value[index])) return false;
    }
    return true;
  }
  return !hasOwnKeys(value);
}

function forEachEntry(value, callback) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) callback(index, value[index]);
  } else {
    for (const key in value) {
      if (hasOwn(value, key)) callback(key, value[key]);
    }
  }
}

export function buildGraphModel(root) {
  const nodes = new Map();
  const order = [];
  const rootNode = { id: ROOT_ID, key: null, parentId: null, depth: 0, value: root, childIds: EMPTY, view: null };
  nodes.set(ROOT_ID, rootNode);

  const stack = [rootNode];
  while (stack.length > 0) {
    const node = stack.pop();
    order.push(node.id);
    if (!isContainer(node.value)) continue;
    if (node.depth >= MAX_GRAPH_DEPTH) {
      node.depthLimited = true;
      continue;
    }

    const children = [];
    forEachEntry(node.value, (key, value) => {
      if (isInlineValue(value)) return;
      const child = {
        id: childNodeId(node.id, key),
        key,
        parentId: node.id,
        depth: node.depth + 1,
        value,
        childIds: EMPTY,
        view: null,
      };
      nodes.set(child.id, child);
      children.push(child);
    });

    if (children.length > 0) {
      node.childIds = children.map((child) => child.id);
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
    }
  }

  return { rootId: ROOT_ID, nodes, order };
}

export function getNodePath(model, nodeId) {
  const path = [];
  let node = model.nodes.get(nodeId);
  while (node && node.parentId !== null) {
    path.unshift(node.key);
    node = model.nodes.get(node.parentId);
  }
  return path;
}

/** Maps a JSON path to the node that displays it, plus the row key when it is an inline row. */
export function findNodeForPath(model, path) {
  let nodeId = model.rootId;
  for (let index = 0; index < path.length; index += 1) {
    const candidate = childNodeId(nodeId, path[index]);
    if (!model.nodes.has(candidate)) {
      return { nodeId, rowKey: path[index] };
    }
    nodeId = candidate;
  }
  return { nodeId, rowKey: null };
}

/* ─── Node presentation ─── */

let measuredCharWidth = null;

/** Width of one character of the node font, measured once with a canvas. */
export function getCharWidth() {
  if (measuredCharWidth !== null) return measuredCharWidth;
  measuredCharWidth = 7.3;
  try {
    const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
    if (!isJsdom && typeof document !== 'undefined') {
      const context = document.createElement('canvas').getContext('2d');
      if (context) {
        context.font = '12px ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
        const width = context.measureText('0123456789abcdefghijklmnopqrstuvwxyz').width / 36;
        if (width > 4 && width < 12) measuredCharWidth = width;
      }
    }
  } catch {
    // Keep the fallback width.
  }
  return measuredCharWidth;
}

export function formatScalar(value) {
  if (typeof value === 'string') {
    const text = JSON.stringify(value.length > MAX_ROW_TEXT ? value.slice(0, MAX_ROW_TEXT) : value);
    return value.length > MAX_ROW_TEXT ? `${text.slice(0, -1)}…"` : text;
  }
  return String(value);
}

function formatInline(value) {
  if (!isContainer(value)) return formatScalar(value);
  if (Array.isArray(value)) {
    let text = '[';
    for (let index = 0; index < value.length; index += 1) {
      text += (index > 0 ? ', ' : '') + formatScalar(value[index]);
      if (text.length > MAX_ROW_TEXT) return `${text.slice(0, MAX_ROW_TEXT)}…]`;
    }
    return `${text}]`;
  }
  return '{}';
}

/** Integers beyond ±2^53 cannot be represented exactly once parsed into JavaScript numbers. */
export function isImpreciseNumber(value) {
  return typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value);
}

function valueKind(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length === 0 ? 'empty' : 'array';
  if (typeof value === 'object') return 'empty';
  return typeof value;
}

function findHint(value) {
  if (!isContainer(value) || Array.isArray(value)) return null;
  for (const key of NAME_KEYS) {
    const candidate = value[key];
    if (hasOwn(value, key) && (typeof candidate === 'string' || typeof candidate === 'number') && candidate !== '') {
      return String(candidate).slice(0, 60);
    }
  }
  return null;
}

/** Rows, labels and pixel size for a node. Cached on the model node. */
export function getNodeView(node) {
  if (node.view) return node.view;
  const { value } = node;
  const charWidth = getCharWidth();
  const { headerHeight, rowHeight, paddingX, paddingY, minWidth, maxWidth } = NODE_METRICS;

  const isRoot = node.parentId === null;
  const isArrayItem = typeof node.key === 'number';
  const label = isRoot ? 'root' : isArrayItem ? `[${node.key}]` : String(node.key);
  const hint = isArrayItem ? findHint(value) : null;

  if (!isContainer(value)) {
    const text = formatScalar(value);
    const width = clamp(paddingX * 2 + text.length * charWidth * 1.15 + 8, minWidth, maxWidth);
    node.view = {
      label,
      hint,
      kind: 'value',
      valueKind: valueKind(value),
      text,
      approx: isImpreciseNumber(value),
      rows: EMPTY,
      hiddenRows: 0,
      entryCount: 0,
      width,
      height: headerHeight + rowHeight + paddingY * 2,
    };
    return node.view;
  }

  const isArray = Array.isArray(value);
  const rows = [];
  let totalRows = 0;
  let entryCount = 0;
  let widestRow = 0;
  forEachEntry(value, (key, entryValue) => {
    entryCount += 1;
    const inline = isInlineValue(entryValue);
    if (!inline && !node.depthLimited) return;
    totalRows += 1;
    if (rows.length >= MAX_ROWS) return;
    const keyText = isArray ? `[${key}]` : String(key);
    const text = inline ? formatInline(entryValue) : Array.isArray(entryValue) ? '[…]' : '{…}';
    const row = { key, keyText, text, kind: inline ? valueKind(entryValue) : 'deep' };
    if (isImpreciseNumber(entryValue)) row.approx = true;
    rows.push(row);
    widestRow = Math.max(widestRow, keyText.length + 2 + text.length);
  });

  const count = entryCount.toLocaleString('en-US');
  const chip = isArray ? `[${count}]` : `{${count}}`;
  const headerChars = label.length + (hint ? hint.length + 3 : 0) + chip.length + 3;
  const contentChars = Math.max(widestRow, headerChars * 1.08);
  const width = clamp(Math.ceil(paddingX * 2 + contentChars * charWidth + 6), minWidth, maxWidth);
  const hiddenRows = totalRows - rows.length;
  const rowCount = rows.length + (hiddenRows > 0 ? 1 : 0);
  const height = headerHeight + (rowCount > 0 ? rowCount * rowHeight + paddingY * 2 : 0);

  node.view = { label, hint, kind: isArray ? 'array' : 'object', chip, rows, hiddenRows, entryCount, width, height };
  return node.view;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/* ─── Visibility & layout ─── */

/**
 * Decides which nodes are visible. Nodes expand breadth-first until the node budget is spent,
 * so large documents show their overall shape instead of one fully expanded branch. Explicit
 * user toggles (`expansion`) always win, and wide nodes page their children in blocks.
 */
export function computeVisibility(model, { expansion = new Map(), mode = 'auto', pageSizes = new Map() } = {}) {
  const budget = mode === 'expanded' ? EXPAND_ALL_BUDGET : AUTO_EXPAND_BUDGET;
  const childrenOf = new Map();
  const collapsedIds = new Set();
  const stubs = new Map();
  let visibleCount = 1;
  let budgetExhausted = false;

  const queue = [model.rootId];
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    const node = model.nodes.get(id);
    const total = node.childIds.length;
    if (total === 0) continue;

    const pageSize = Math.max(CHILD_PAGE_SIZE, pageSizes.get(id) ?? CHILD_PAGE_SIZE);
    const shown = Math.min(total, pageSize);
    const cost = shown + (shown < total ? 1 : 0);
    const explicit = expansion.get(id);

    let expanded;
    if (explicit !== undefined) expanded = explicit;
    else if (id === model.rootId) expanded = true;
    else if (mode === 'collapsed') expanded = false;
    else {
      expanded = !budgetExhausted && visibleCount + cost <= budget;
      if (!expanded) budgetExhausted = true;
    }

    if (!expanded) {
      collapsedIds.add(id);
      continue;
    }

    visibleCount += cost;
    const children = shown === total ? node.childIds : node.childIds.slice(0, shown);
    queue.push(...children);
    if (shown < total) {
      const stubId = moreNodeId(id);
      stubs.set(stubId, { parentId: id, shown, remaining: total - shown });
      childrenOf.set(id, [...children, stubId]);
    } else {
      childrenOf.set(id, children);
    }
  }

  return { childrenOf, collapsedIds, stubs, visibleCount };
}

/**
 * Tidy tree layout: each subtree gets a band on the cross axis, parents are centred on their
 * children, and depth levels line up on the main axis. `direction` is 'LR' or 'TB'.
 */
export function layoutTree({ rootId, childrenOf, sizeOf, direction = 'LR' }) {
  const horizontal = direction === 'LR';
  const gapMain = horizontal ? NODE_METRICS.gapMain : NODE_METRICS.gapMainVertical;
  const gapCross = horizontal ? NODE_METRICS.gapCross : NODE_METRICS.gapCrossVertical;
  const crossSize = (size) => (horizontal ? size.height : size.width);
  const mainSize = (size) => (horizontal ? size.width : size.height);

  const order = [];
  const depthOf = new Map([[rootId, 0]]);
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    order.push(id);
    const children = childrenOf.get(id) || EMPTY;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      depthOf.set(children[index], depthOf.get(id) + 1);
      stack.push(children[index]);
    }
  }

  const levelExtent = [];
  order.forEach((id) => {
    const depth = depthOf.get(id);
    levelExtent[depth] = Math.max(levelExtent[depth] || 0, mainSize(sizeOf(id)));
  });
  const levelOffset = [];
  levelExtent.reduce((offset, extent, depth) => {
    levelOffset[depth] = offset;
    return offset + extent + gapMain;
  }, 0);

  const band = new Map();
  const childSpan = new Map();
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const id = order[index];
    const children = childrenOf.get(id) || EMPTY;
    const own = crossSize(sizeOf(id));
    if (children.length === 0) {
      band.set(id, own);
      continue;
    }
    let span = gapCross * (children.length - 1);
    children.forEach((childId) => {
      span += band.get(childId);
    });
    childSpan.set(id, span);
    band.set(id, Math.max(own, span));
  }

  const positions = new Map();
  const bandStart = new Map([[rootId, 0]]);
  order.forEach((id) => {
    const start = bandStart.get(id);
    const size = sizeOf(id);
    const cross = start + (band.get(id) - crossSize(size)) / 2;
    const main = levelOffset[depthOf.get(id)];
    positions.set(id, horizontal ? { x: main, y: cross } : { x: cross, y: main });

    const children = childrenOf.get(id) || EMPTY;
    if (children.length > 0) {
      let cursor = start + (band.get(id) - childSpan.get(id)) / 2;
      children.forEach((childId) => {
        bandStart.set(childId, cursor);
        cursor += band.get(childId) + gapCross;
      });
    }
  });

  return { positions, order };
}

/** Produces React Flow nodes and edges for the visible part of the model. */
export function buildFlowGraph(model, options = {}) {
  const direction = options.direction || 'LR';
  const { childrenOf, collapsedIds, stubs } = computeVisibility(model, options);
  const sizeOf = (id) => {
    const stub = stubs.get(id);
    if (stub) return { width: NODE_METRICS.moreWidth, height: NODE_METRICS.moreHeight };
    const view = getNodeView(model.nodes.get(id));
    return { width: view.width, height: view.height };
  };
  const { positions, order } = layoutTree({ rootId: model.rootId, childrenOf, sizeOf, direction });

  const horizontal = direction === 'LR';
  const sourcePosition = horizontal ? 'right' : 'bottom';
  const targetPosition = horizontal ? 'left' : 'top';
  const nodes = [];
  const edges = [];
  const parentOf = new Map();
  const nodeOrder = [];

  order.forEach((id) => {
    const size = sizeOf(id);
    const stub = stubs.get(id);
    const common = {
      id,
      position: positions.get(id),
      style: { width: size.width, height: size.height },
      sourcePosition,
      targetPosition,
      draggable: false,
      connectable: false,
      selectable: false,
    };

    if (stub) {
      nodes.push({ ...common, type: 'more', data: { ...stub, direction } });
    } else {
      const modelNode = model.nodes.get(id);
      const collapsed = collapsedIds.has(id);
      nodes.push({
        ...common,
        type: 'json',
        data: getNodeData(modelNode, collapsed, direction),
      });
      nodeOrder.push(id);
    }

    (childrenOf.get(id) || EMPTY).forEach((childId) => {
      parentOf.set(childId, id);
      edges.push({
        id: `e:${childId}`,
        source: id,
        target: childId,
        type: 'default',
        className: stubs.has(childId) ? 'je-edge je-edge--more' : 'je-edge',
      });
    });
  });

  return { nodes, edges, order: nodeOrder, childrenOf, parentOf, collapsedIds, stubs };
}

function getNodeData(modelNode, collapsed, direction) {
  const cacheKey = `${direction}:${collapsed ? 1 : 0}`;
  if (modelNode.dataCache && modelNode.dataCache.key === cacheKey) return modelNode.dataCache.data;
  const data = {
    view: getNodeView(modelNode),
    isRoot: modelNode.parentId === null,
    childCount: modelNode.childIds.length,
    collapsed,
    direction,
  };
  modelNode.dataCache = { key: cacheKey, data };
  return data;
}

/* ─── Search & navigation ─── */

function scalarMatches(value, needle) {
  if (isContainer(value)) {
    if (!Array.isArray(value)) return false;
    return value.some((item) => !isContainer(item) && String(item).toLowerCase().includes(needle));
  }
  return String(value).toLowerCase().includes(needle);
}

export function nodeMatchesQuery(node, needle) {
  if (typeof node.key === 'string' && node.key.toLowerCase().includes(needle)) return true;
  const { value } = node;
  if (!isContainer(value)) return scalarMatches(value, needle);
  if (Array.isArray(value)) {
    return value.some((item) => isInlineValue(item) && scalarMatches(item, needle));
  }
  for (const key in value) {
    if (
      hasOwn(value, key) &&
      isInlineValue(value[key]) &&
      (key.toLowerCase().includes(needle) || scalarMatches(value[key], needle))
    ) {
      return true;
    }
  }
  return false;
}

/** Ids of every node (visible or not) whose key or inline rows contain `query`, in document order. */
export function searchModel(model, query, limit = 5000) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches = [];
  for (const id of model.order) {
    if (nodeMatchesQuery(model.nodes.get(id), needle)) {
      matches.push(id);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

/** Returns expansion/page-size maps that make `nodeId` visible by expanding its ancestors. */
export function revealNode(model, nodeId, expansion, pageSizes) {
  const nextExpansion = new Map(expansion);
  const nextPageSizes = new Map(pageSizes);
  let node = model.nodes.get(nodeId);
  while (node && node.parentId !== null) {
    const parent = model.nodes.get(node.parentId);
    nextExpansion.set(parent.id, true);
    const index = parent.childIds.indexOf(node.id);
    const pageSize = nextPageSizes.get(parent.id) ?? CHILD_PAGE_SIZE;
    if (index >= pageSize) {
      nextPageSizes.set(parent.id, Math.ceil((index + 1) / CHILD_PAGE_SIZE) * CHILD_PAGE_SIZE);
    }
    node = parent;
  }
  return { expansion: nextExpansion, pageSizes: nextPageSizes };
}

/** Ids from the root down to `nodeId` (inclusive) and the edges connecting them. */
export function getLineage(parentOf, nodeId) {
  const nodeIds = [];
  const edgeIds = [];
  let current = nodeId;
  while (current) {
    nodeIds.push(current);
    const parent = parentOf.get(current);
    if (parent) edgeIds.push(`e:${current}`);
    current = parent;
  }
  return { nodeIds, edgeIds };
}

/**
 * Keyboard navigation between visible nodes. `move` is one of parent/child/prev/next.
 */
export function getNeighborNode(graph, nodeId, move) {
  const { childrenOf, parentOf, stubs } = graph;
  const realChildren = (id) => (childrenOf.get(id) || EMPTY).filter((childId) => !stubs.has(childId));
  if (move === 'parent') return parentOf.get(nodeId) ?? null;
  if (move === 'child') return realChildren(nodeId)[0] ?? null;

  const parent = parentOf.get(nodeId);
  if (!parent) return null;
  const siblings = realChildren(parent);
  const index = siblings.indexOf(nodeId);
  const next = move === 'next' ? siblings[index + 1] : siblings[index - 1];
  return next ?? null;
}
