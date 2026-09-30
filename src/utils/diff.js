import { getValueType, isContainer, isNumber, numberKey } from './json';
import { diffSequences } from './sequence';

// Keys that identify a record: its id (id, _id, uuid, guid, sku, or a key such as productId or
// order_id), or else its key or name, which may change when the item is renamed.
const ID_KEYS = ['id', '_id', 'uuid', 'guid', 'sku'];
const ID_SUFFIX = /^[A-Za-z][A-Za-z0-9]*(?:Id|ID|_id|_ID)$/;
const NAME_KEYS = ['key', 'name'];
// Arrays are aligned with Myers' algorithm (as git diff does): O((n + m) · d) for d inserted or
// removed items, so it is fast when few items differ. Past this many, items are aligned by identity.
const MAX_EDITS = 2000;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * Structural diff of two JSON values. Objects are compared by key (ignoring key order).
 * Arrays are aligned like a line diff, so inserting one item does not report every following
 * item as changed; objects carrying an id (or a key or name) are matched by it, and an item that
 * turns up at another place in the array is reported as moved rather than as removed and added.
 * If it also changed, its changes are reported instead, each at its new path with the old one:
 * the move is not a difference of its own. Two records with different ids are never paired up.
 *
 * Each change is `{ kind: 'added' | 'removed' | 'changed' | 'moved', path, leftPath, rightPath, before, after }`.
 * `arrays` picks how array items are paired: 'align' (the default, above), 'unordered' (the same,
 * but a change of position is not a difference) or 'index' (position by position).
 */
export function diffJson(left, right, { limit = 1000, arrays = 'align' } = {}) {
  const changes = [];
  const counts = { added: 0, removed: 0, changed: 0, moved: 0 };
  const canonicalCache = new WeakMap();

  const record = (change) => {
    counts[change.kind] += 1;
    if (changes.length < limit) changes.push(change);
  };

  const canonical = (value) => {
    // Numbers compare by exact value, so 1.5 and 1.50 match while two IDs beyond 2^53 stay apart.
    if (isNumber(value)) return `#${numberKey(value)}`;
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

  /**
   * An object's identity as `{ key, strong }` (a match key, and whether it is a real id rather than
   * a name that may change), or null when it has none.
   */
  const idOf = (item) => {
    if (!isContainer(item) || Array.isArray(item)) return null;
    const usable = (key) => hasOwn(item, key) && (typeof item[key] === 'string' || isNumber(item[key]));
    const strongKey = ID_KEYS.find(usable) ?? Object.keys(item).find((key) => ID_SUFFIX.test(key) && usable(key));
    const key = strongKey ?? NAME_KEYS.find(usable);
    if (key === undefined) return null;
    const value = item[key];
    return { key: `#${key}:${isNumber(value) ? numberKey(value) : JSON.stringify(value)}`, strong: strongKey !== undefined };
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
    } else if (a !== b && (typeA !== 'number' || numberKey(a) !== numberKey(b))) {
      record({ kind: 'changed', path: rightPath, leftPath, rightPath, before: a, after: b });
    }
  };

  const compareObjects = (a, b, leftPath, rightPath) => {
    Object.keys(a).forEach((key) => {
      if (hasOwn(b, key)) {
        compare(a[key], b[key], [...leftPath, key], [...rightPath, key]);
      } else {
        record({ kind: 'removed', path: [...leftPath, key], leftPath: [...leftPath, key], rightPath: null, before: a[key] });
      }
    });
    Object.keys(b).forEach((key) => {
      if (!hasOwn(a, key)) record({ kind: 'added', path: [...rightPath, key], leftPath: null, rightPath: [...rightPath, key], after: b[key] });
    });
  };

  const compareArrays = (a, b, leftPath, rightPath) => {
    const removed = (i) => record({ kind: 'removed', path: [...leftPath, i], leftPath: [...leftPath, i], rightPath: null, before: a[i] });
    const added = (j) => record({ kind: 'added', path: [...rightPath, j], leftPath: null, rightPath: [...rightPath, j], after: b[j] });
    const pair = (i, j) => compare(a[i], b[j], [...leftPath, i], [...rightPath, j]);

    if (arrays === 'index') {
      // Position by position: item i on the left is compared with item i on the right.
      const shared = Math.min(a.length, b.length);
      for (let index = 0; index < shared; index += 1) pair(index, index);
      for (let index = shared; index < a.length; index += 1) removed(index);
      for (let index = shared; index < b.length; index += 1) added(index);
      return;
    }

    const idsA = a.map(idOf);
    const idsB = b.map(idOf);
    const keysA = a.map((item, index) => idsA[index]?.key ?? canonical(item));
    const keysB = b.map((item, index) => idsB[index]?.key ?? canonical(item));
    const matches = alignKeys(keysA, keysB);

    // Unmatched items whose key also turns up unmatched on the other side moved; pair them in order.
    const matchedA = new Uint8Array(a.length);
    const matchedB = new Uint8Array(b.length);
    matches.forEach(([i, j]) => {
      matchedA[i] = 1;
      matchedB[j] = 1;
    });
    const arrivals = new Map();
    keysB.forEach((key, j) => {
      if (matchedB[j]) return;
      const queue = arrivals.get(key);
      if (queue) queue.push(j);
      else arrivals.set(key, [j]);
    });
    const movedTo = new Map();
    const movedFrom = new Map();
    const taken = new Map();
    keysA.forEach((key, i) => {
      if (matchedA[i] || !arrivals.has(key)) return;
      const queue = arrivals.get(key);
      const next = taken.get(key) ?? 0;
      if (next === queue.length) return;
      taken.set(key, next + 1);
      movedTo.set(i, queue[next]);
      movedFrom.set(queue[next], i);
    });

    let i = 0;
    let j = 0;
    const flushGap = (untilA, untilB) => {
      const lefts = [];
      const rights = [];
      const moves = [];
      for (; i < untilA; i += 1) if (!movedTo.has(i)) lefts.push(i);
      for (; j < untilB; j += 1) (movedFrom.has(j) ? moves : rights).push(j);
      // Leftovers facing each other in the same gap are edits in place (a renamed item), unless
      // both carry an id: then they are different records, one removed and one added.
      const edits = [];
      const gone = [];
      const fresh = [];
      lefts.forEach((li, k) => {
        const rj = rights[k];
        if (rj !== undefined && !(idsA[li]?.strong && idsB[rj]?.strong)) {
          edits.push([li, rj]);
        } else {
          gone.push(li);
          if (rj !== undefined) fresh.push(rj);
        }
      });
      fresh.push(...rights.slice(lefts.length));
      edits.forEach(([li, rj]) => pair(li, rj));
      gone.forEach(removed);
      fresh.forEach(added);
      moves.forEach((rj) => {
        const li = movedFrom.get(rj);
        const recorded = counts.added + counts.removed + counts.changed + counts.moved;
        pair(li, rj);
        const changedInside = counts.added + counts.removed + counts.changed + counts.moved > recorded;
        if (arrays !== 'unordered' && !changedInside) record({ kind: 'moved', path: [...rightPath, rj], leftPath: [...leftPath, li], rightPath: [...rightPath, rj], before: a[li], after: b[rj] });
      });
    };

    matches.forEach(([matchA, matchB]) => {
      flushGap(matchA, matchB);
      pair(matchA, matchB);
      i = matchA + 1;
      j = matchB + 1;
    });
    flushGap(a.length, b.length);
  };

  compare(left, right, [], []);
  const total = counts.added + counts.removed + counts.changed + counts.moved;
  return { changes, counts, total, truncated: changes.length < total };
}

/**
 * Pairs equal keys of two sequences, in order in both: the items a line diff would keep.
 * Myers' algorithm finds the fewest insertions and removals (an exact longest common subsequence);
 * past MAX_EDITS of them, equal keys are paired by occurrence and the longest run of pairs that
 * stays in order is kept, which is still exact when the keys are unique (records with ids).
 */
function alignKeys(keysA, keysB) {
  const ops = diffSequences(keysA, keysB, MAX_EDITS);
  const matches = [];
  if (ops !== null) {
    ops.forEach(({ type, a, b, count }) => {
      if (type === 'equal') for (let index = 0; index < count; index += 1) matches.push([a + index, b + index]);
    });
    return matches;
  }
  let start = 0;
  while (start < keysA.length && start < keysB.length && keysA[start] === keysB[start]) start += 1;
  let endA = keysA.length;
  let endB = keysB.length;
  while (endA > start && endB > start && keysA[endA - 1] === keysB[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  for (let index = 0; index < start; index += 1) matches.push([index, index]);
  increasingPairs(keysA, keysB, start, endA, endB).forEach((match) => matches.push(match));
  for (let index = 0; endA + index < keysA.length; index += 1) matches.push([endA + index, endB + index]);
  return matches;
}

function increasingPairs(keysA, keysB, start, endA, endB) {
  // The k-th occurrence of a key on the right pairs with its k-th occurrence on the left.
  const positions = new Map();
  for (let i = start; i < endA; i += 1) {
    const list = positions.get(keysA[i]);
    if (list) list.push(i);
    else positions.set(keysA[i], [i]);
  }
  const used = new Map();
  const pairs = [];
  for (let j = start; j < endB; j += 1) {
    const list = positions.get(keysB[j]);
    const next = used.get(keysB[j]) ?? 0;
    if (list === undefined || next === list.length) continue;
    used.set(keysB[j], next + 1);
    pairs.push([list[next], j]);
  }
  // Longest increasing subsequence of the left positions (patience sorting, O(p log p)).
  const tails = [];
  const previous = new Int32Array(pairs.length);
  pairs.forEach(([i], p) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (pairs[tails[mid]][0] < i) low = mid + 1;
      else high = mid;
    }
    previous[p] = low > 0 ? tails[low - 1] : -1;
    tails[low] = p;
  });
  const matches = [];
  for (let p = tails.length > 0 ? tails[tails.length - 1] : -1; p !== -1; p = previous[p]) matches.push(pairs[p]);
  return matches.reverse();
}

/**
 * Drops the changes at or under the nodes that `selectors` (compiled JSONPaths, see
 * src/cli/jsonpath.js) select: a change's left path is checked against what they select in the
 * left document, its right path against the right document. Selecting a root drops everything.
 * `options` are passed to each selector's evaluate() (such as `conceal`).
 */
export function withoutIgnored(changes, [left, right], selectors, options = {}) {
  if (selectors.length === 0) return changes;
  const selected = (document) => {
    const paths = new Set();
    selectors.forEach((selector) => selector.evaluate(document, options).forEach((node) => paths.add(JSON.stringify(node.path))));
    return paths;
  };
  const ignoredLeft = selected(left);
  const ignoredRight = selected(right);
  if (ignoredLeft.has('[]') || ignoredRight.has('[]')) return [];
  const covered = (pathArray, ignored) => pathArray !== null && pathArray.some((_, index) => ignored.has(JSON.stringify(pathArray.slice(0, index + 1))));
  return changes.filter((change) => !covered(change.leftPath, ignoredLeft) && !covered(change.rightPath, ignoredRight));
}
