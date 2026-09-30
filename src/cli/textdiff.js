/*
 * Text diffs for showing what a repair changed: a unified line diff for normal files, and
 * per-change snippets for minified (single-line) files, both from Myers' O(ND) algorithm.
 */

import { diffSequences } from '../utils/sequence';

export { diffSequences };

/** A unified diff of two texts' lines (`--- label` / `+++ label` / `@@` hunks with context). */
export function unifiedDiff(before, after, { from = 'original', to = 'changed', context = 3, maxEdits } = {}) {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const ops = diffSequences(a, b, maxEdits);
  if (ops === null) return null;
  // One row per line; `ai`/`bi` are the 0-based positions in each text where the row sits.
  const rows = [];
  for (const op of ops) {
    for (let offset = 0; offset < op.count; offset += 1) {
      if (op.type === 'equal') rows.push({ sign: ' ', text: a[op.a + offset], ai: op.a + offset, bi: op.b + offset });
      else if (op.type === 'delete') rows.push({ sign: '-', text: a[op.a + offset], ai: op.a + offset, bi: op.b });
      else rows.push({ sign: '+', text: b[op.b + offset], ai: op.a, bi: op.b + offset });
    }
  }
  const changed = [];
  rows.forEach((row, index) => {
    if (row.sign !== ' ') changed.push(index);
  });
  if (changed.length === 0) return '';
  const lines = [`--- ${from}`, `+++ ${to}`];
  for (let index = 0; index < changed.length; index += 1) {
    const start = Math.max(0, changed[index] - context);
    // Like diff -u: changes separated by at most 2 × context unchanged lines share a hunk.
    while (index + 1 < changed.length && changed[index + 1] - changed[index] - 1 <= context * 2) index += 1;
    const end = Math.min(rows.length - 1, changed[index] + context);
    const hunk = rows.slice(start, end + 1);
    const countA = hunk.filter((row) => row.sign !== '+').length;
    const countB = hunk.filter((row) => row.sign !== '-').length;
    const startA = countA > 0 ? hunk[0].ai + 1 : hunk[0].ai;
    const startB = countB > 0 ? hunk[0].bi + 1 : hunk[0].bi;
    lines.push(`@@ -${startA},${countA} +${startB},${countB} @@`);
    hunk.forEach((row) => lines.push(`${row.sign}${row.text}`));
  }
  return lines.join('\n');
}

const TOKEN = /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|[-+]?\d[\w.+-]*|[A-Za-z_$][\w$]*|\s+|[\s\S]/g;

function lineColumn(text, offset) {
  let line = 1;
  let lineStart = 0;
  for (let index = text.indexOf('\n'); index !== -1 && index < offset; index = text.indexOf('\n', index + 1)) {
    line += 1;
    lineStart = index + 1;
  }
  return { line, column: offset - lineStart + 1 };
}

/** The number of separate changes between two texts (compared token by token), or null if too many. */
export function countChanges(before, after, maxEdits) {
  const ops = diffSequences(before.match(TOKEN) ?? [], after.match(TOKEN) ?? [], maxEdits);
  if (ops === null) return null;
  return ops.filter((op, index) => op.type !== 'equal' && (index === 0 || ops[index - 1].type === 'equal')).length;
}

/**
 * Change snippets for texts with very long lines (minified JSON), where a line diff would be one
 * huge line: each change is shown with a little context and its position in the original.
 */
export function changeSnippets(before, after, { context = 24, maxEdits, maxChanges = 50 } = {}) {
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];
  const ops = diffSequences(a, b, maxEdits);
  if (ops === null) return null;
  const offsetsA = [0];
  a.forEach((token) => offsetsA.push(offsetsA[offsetsA.length - 1] + token.length));
  const offsetsB = [0];
  b.forEach((token) => offsetsB.push(offsetsB[offsetsB.length - 1] + token.length));
  // Runs of edits, merged when their excerpts would overlap so each place is shown once.
  const places = [];
  for (let index = 0; index < ops.length; index += 1) {
    if (ops[index].type === 'equal') continue;
    let end = index;
    while (end + 1 < ops.length && ops[end + 1].type !== 'equal') end += 1;
    const first = ops[index];
    const last = ops[end];
    const place = {
      startA: offsetsA[first.a],
      startB: offsetsB[first.b],
      endA: offsetsA[last.a + (last.type === 'delete' ? last.count : 0)],
      endB: offsetsB[last.b + (last.type === 'insert' ? last.count : 0)],
    };
    const previous = places[places.length - 1];
    if (previous && place.startA - previous.endA <= context * 2) {
      previous.endA = place.endA;
      previous.endB = place.endB;
    } else {
      places.push(place);
    }
    index = end;
  }
  // Each excerpt is one line: a line break shows as ⏎, so that text after it cannot read as part of a comment before it.
  const oneLine = (text) => text.replace(/[^\S\n]*\r?\n\s*/g, ' ⏎ ').replace(/\s+/g, ' ');
  const clip = (text, start, finish) =>
    `${start - context > 0 ? '…' : ''}${oneLine(text.slice(Math.max(0, start - context), finish + context))}${finish + context < text.length ? '…' : ''}`;
  const snippets = places.slice(0, maxChanges).map(({ startA, endA, startB, endB }) => {
    const { line, column } = lineColumn(before, startA);
    return `line ${line}, column ${column}:\n  - ${clip(before, startA, endA)}\n  + ${clip(after, startB, endB)}`;
  });
  const extra = places.length > maxChanges ? `\n… ${places.length - maxChanges} more places changed` : '';
  return snippets.join('\n') + extra;
}
