import { getValueType, isContainer } from './json';

const ID_KEYS = ['id', '_id', 'uuid', 'key', 'name'];
// Past this many cells the LCS table gets too large; fall back to index-by-index pairing.
const MAX_LCS_CELLS = 4_000_000;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * Structural diff of two JSON values. Objects are compared by key (ignoring key order).
 * Arrays are aligned with a longest-common-subsequence pass, so inserting one item does not
 * report every following item as changed; objects carrying an id-like key are matched by it.
 *
 * Each change is `{ kind: 'added' | 'removed' | 'changed', path, leftPath, rightPath, before, after }`.
 */
export function diffJson(left, right, { limit = 1000 } = {}) {
  const changes = [];
  const counts = { added: 0, removed: 0, changed: 0 };
  const canonicalCache = new WeakMap();

  const record = (change) => {
    counts[change.kind] += 1;
    if (changes.length < limit) changes.push(change);
  };

  const canonical = (value) => {
    if (!isContainer(value)) return JSON.stringify(value);
    const cached = canonicalCache.get(value);
    if (cached !== undefined) return cached;
    const text = Array.isArray(value)
      ? `[${value.map(canonical).join(',')}]`
      : `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(',')}}`;
    canonicalCache.set(value, text);
    return text;
  };

  const identity = (item) => {
    if (isContainer(item) && !Array.isArray(item)) {
      for (const key of ID_KEYS) {
        const candidate = item[key];
        if (hasOwn(item, key) && (typeof candidate === 'string' || typeof candidate === 'number')) {
          return `#${key}:${candidate}`;
        }
      }
    }
    return canonical(item);
  };

  const compare = (a, b, leftPath, rightPath) => {
    const typeA = getValueType(a);
    const typeB = getValueType(b);
    if (typeA !== typeB) {
      record({ kind: 'changed', path: rightPath, leftPath, rightPath, before: a, after: b, typeChanged: true });
      return;
    }
    if (typeA === 'object') {
      compareObjects(a, b, leftPath, rightPath);
    } else if (typeA === 'array') {
      compareArrays(a, b, leftPath, rightPath);
    } else if (a !== b) {
      record({ kind: 'changed', path: rightPath, leftPath, rightPath, before: a, after: b });
    }
  };

  const compareObjects = (a, b, leftPath, rightPath) => {
    for (const key in a) {
      if (!hasOwn(a, key)) continue;
      if (hasOwn(b, key)) {
        compare(a[key], b[key], [...leftPath, key], [...rightPath, key]);
      } else {
        record({ kind: 'removed', path: [...leftPath, key], leftPath: [...leftPath, key], rightPath: null, before: a[key] });
      }
    }
    for (const key in b) {
      if (hasOwn(b, key) && !hasOwn(a, key)) {
        record({ kind: 'added', path: [...rightPath, key], leftPath: null, rightPath: [...rightPath, key], after: b[key] });
      }
    }
  };

  const compareArrays = (a, b, leftPath, rightPath) => {
    let start = 0;
    while (start < a.length && start < b.length && identity(a[start]) === identity(b[start])) {
      compare(a[start], b[start], [...leftPath, start], [...rightPath, start]);
      start += 1;
    }
    let endA = a.length;
    let endB = b.length;
    const tail = [];
    while (endA > start && endB > start && identity(a[endA - 1]) === identity(b[endB - 1])) {
      endA -= 1;
      endB -= 1;
      tail.push([endA, endB]);
    }
    tail.reverse();

    const matches = alignMiddle(a, b, start, endA, start, endB);
    let i = start;
    let j = start;
    const flushGap = (untilA, untilB) => {
      // Pair leftover items in the same gap as in-place modifications, the rest are adds/removes.
      while (i < untilA && j < untilB) {
        compare(a[i], b[j], [...leftPath, i], [...rightPath, j]);
        i += 1;
        j += 1;
      }
      for (; i < untilA; i += 1) {
        record({ kind: 'removed', path: [...leftPath, i], leftPath: [...leftPath, i], rightPath: null, before: a[i] });
      }
      for (; j < untilB; j += 1) {
        record({ kind: 'added', path: [...rightPath, j], leftPath: null, rightPath: [...rightPath, j], after: b[j] });
      }
    };

    matches.forEach(([matchA, matchB]) => {
      flushGap(matchA, matchB);
      compare(a[matchA], b[matchB], [...leftPath, matchA], [...rightPath, matchB]);
      i = matchA + 1;
      j = matchB + 1;
    });
    flushGap(endA, endB);
    tail.forEach(([indexA, indexB]) => compare(a[indexA], b[indexB], [...leftPath, indexA], [...rightPath, indexB]));
  };

  const alignMiddle = (a, b, startA, endA, startB, endB) => {
    const n = endA - startA;
    const m = endB - startB;
    if (n === 0 || m === 0 || n * m > MAX_LCS_CELLS) return [];

    const keysA = [];
    const keysB = [];
    for (let index = startA; index < endA; index += 1) keysA.push(identity(a[index]));
    for (let index = startB; index < endB; index += 1) keysB.push(identity(b[index]));

    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let x = n - 1; x >= 0; x -= 1) {
      for (let y = m - 1; y >= 0; y -= 1) {
        table[x * width + y] =
          keysA[x] === keysB[y]
            ? table[(x + 1) * width + y + 1] + 1
            : Math.max(table[(x + 1) * width + y], table[x * width + y + 1]);
      }
    }

    const matches = [];
    let x = 0;
    let y = 0;
    while (x < n && y < m) {
      if (keysA[x] === keysB[y]) {
        matches.push([startA + x, startB + y]);
        x += 1;
        y += 1;
      } else if (table[(x + 1) * width + y] >= table[x * width + y + 1]) {
        x += 1;
      } else {
        y += 1;
      }
    }
    return matches;
  };

  compare(left, right, [], []);
  return { changes, counts, total: counts.added + counts.removed + counts.changed, truncated: changes.length < counts.added + counts.removed + counts.changed };
}
