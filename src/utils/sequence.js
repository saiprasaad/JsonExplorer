/*
 * Myers' O((n + m) · d) diff of two sequences (git diff's default algorithm), shared by the JSON
 * diff (array items) and the text diffs that show what a repair changed.
 */

/**
 * The edit script between two sequences as `[{ type: 'equal' | 'delete' | 'insert', a, b, count }]`
 * (`a`/`b` are start indices), or null when they differ in more than `maxEdits` places.
 */
export function diffSequences(a, b, maxEdits = 2000) {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > prefix && endB > prefix && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const n = endA - prefix;
  const m = endB - prefix;
  const limit = Math.min(n + m, maxEdits);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= limit && found === -1; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[prefix + x] === b[prefix + y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found === -1) return null;

  // Walk the trace backwards into single steps, then merge runs of the same kind.
  const steps = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const previous = trace[d];
    const at = (k) => previous[k + d + 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const previousK = down ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      steps.push('equal');
      x -= 1;
      y -= 1;
    }
    steps.push(down ? 'insert' : 'delete');
    x = previousX;
    y = previousY;
  }
  // No equal run before the first edit: the common prefix was already set aside.
  steps.reverse();

  const ops = [];
  const push = (type, count, ia, ib) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.count += count;
    else ops.push({ type, a: ia, b: ib, count });
  };
  if (prefix > 0) push('equal', prefix, 0, 0);
  let ia = prefix;
  let ib = prefix;
  for (const step of steps) {
    push(step, 1, ia, ib);
    if (step !== 'insert') ia += 1;
    if (step !== 'delete') ib += 1;
  }
  if (a.length - endA > 0) push('equal', a.length - endA, endA, endB);
  return ops;
}
