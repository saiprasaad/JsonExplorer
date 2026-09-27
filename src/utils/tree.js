import { isContainer } from './json';

export const TREE_ROOT_ID = '$';
export const TREE_AUTO_EXPAND_ROWS = 400;
export const TREE_EXPAND_ALL_ROWS = 50_000;

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export function treeChildId(parentId, key) {
  return `${parentId}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function entryCount(value) {
  if (Array.isArray(value)) return value.length;
  if (!isContainer(value)) return 0;
  let count = 0;
  for (const key in value) if (hasOwn(value, key)) count += 1;
  return count;
}

function forEachEntry(value, callback) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) callback(index, value[index]);
  } else {
    for (const key in value) if (hasOwn(value, key)) callback(key, value[key]);
  }
}

/**
 * Flattens the expanded part of the document into rows for a virtualized list.
 * Each row stores its parent's row index so paths can be rebuilt without per-row arrays.
 */
export function flattenTree(root, expanded) {
  const rows = [];
  const stack = [{ id: TREE_ROOT_ID, key: null, value: root, depth: 0, parent: -1 }];
  while (stack.length > 0) {
    const item = stack.pop();
    const count = entryCount(item.value);
    const isOpen = count > 0 && expanded.has(item.id);
    const index = rows.length;
    // Built explicitly (not with spread): this loop runs for every visible row on each edit.
    rows.push({
      id: item.id,
      key: item.key,
      value: item.value,
      depth: item.depth,
      parent: item.parent,
      count,
      container: isContainer(item.value),
      expanded: isOpen,
    });
    if (!isOpen) continue;
    const children = [];
    forEachEntry(item.value, (key, value) => {
      children.push({ id: treeChildId(item.id, key), key, value, depth: item.depth + 1, parent: index });
    });
    for (let child = children.length - 1; child >= 0; child -= 1) stack.push(children[child]);
  }
  return rows;
}

export function rowPath(rows, index) {
  const path = [];
  let current = rows[index];
  while (current && current.parent !== -1) {
    path.unshift(current.key);
    current = rows[current.parent];
  }
  return path;
}

export function pathToTreeId(path) {
  return path.reduce((id, key) => treeChildId(id, key), TREE_ROOT_ID);
}

/** Ids of every ancestor of `id` (excluding `id` itself), from the root down. */
export function ancestorIds(id) {
  const ids = [];
  let index = id.indexOf('/');
  while (index !== -1) {
    ids.push(id.slice(0, index));
    index = id.indexOf('/', index + 1);
  }
  return ids;
}

/** Expands breadth-first until roughly `maxRows` rows would be visible. */
export function computeExpansion(root, maxRows = TREE_AUTO_EXPAND_ROWS) {
  const expanded = new Set();
  let visible = 1;
  let level = [{ id: TREE_ROOT_ID, value: root }];
  while (level.length > 0) {
    const next = [];
    for (const item of level) {
      const count = entryCount(item.value);
      if (count === 0) continue;
      if (visible + count > maxRows && item.id !== TREE_ROOT_ID) return expanded;
      expanded.add(item.id);
      visible += count;
      forEachEntry(item.value, (key, value) => {
        if (isContainer(value)) next.push({ id: treeChildId(item.id, key), value });
      });
    }
    level = next;
  }
  return expanded;
}

function matches(value, needle) {
  return !isContainer(value) && String(value).toLowerCase().includes(needle);
}

/** Ids of all entries whose key or primitive value contains `query`, in document order. */
export function searchTree(root, query, limit = 5000) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results = [];
  const stack = [{ id: TREE_ROOT_ID, key: null, value: root }];
  while (stack.length > 0 && results.length < limit) {
    const item = stack.pop();
    if ((typeof item.key === 'string' && item.key.toLowerCase().includes(needle)) || matches(item.value, needle)) {
      results.push(item.id);
    }
    if (!isContainer(item.value)) continue;
    const children = [];
    forEachEntry(item.value, (key, value) => children.push({ id: treeChildId(item.id, key), key, value }));
    for (let child = children.length - 1; child >= 0; child -= 1) stack.push(children[child]);
  }
  return results;
}

function shortValue(value) {
  if (Array.isArray(value)) return value.length === 0 ? '[]' : '[…]';
  if (isContainer(value)) return entryCount(value) === 0 ? '{}' : '{…}';
  if (typeof value === 'string') return JSON.stringify(value.length > 24 ? `${value.slice(0, 23)}…` : value);
  return String(value);
}

/** One-line summary of a collapsed container, e.g. `{ id: 1, name: "Ada", … }`. */
export function previewContainer(value, maxLength = 90) {
  const isArray = Array.isArray(value);
  const parts = [];
  let length = 0;
  let truncated = false;
  forEachEntry(value, (key, item) => {
    if (truncated) return;
    const part = isArray ? shortValue(item) : `${key}: ${shortValue(item)}`;
    if (length + part.length > maxLength) {
      truncated = true;
      return;
    }
    parts.push(part);
    length += part.length + 2;
  });
  const body = parts.join(', ') + (truncated ? (parts.length ? ', …' : '…') : '');
  return isArray ? `[${body}]` : `{ ${body} }`;
}
