import { compareNumbers, isContainer, isIntegerNumber, isNumber, numberKey, sliceText } from '../utils/json';
import { isSensitiveMember, looksLikeSecret } from './redact';

/*
 * A structural summary of a document: every distinct path (array items folded into [*]), its
 * types, how often it is present, and value statistics (lengths, formats, ranges, cardinality).
 * Raw values are only included on request (samples, the most common values), and never for
 * secret-looking fields.
 */

const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Objects with this many keys, or keys that look like ids, are maps: their keys fold into ".*".
const DYNAMIC_KEYS = 64;
const MAX_DISTINCT = 1000;
const SAMPLE_LENGTH = 60;
// A number range is shown only for fields with at least this many distinct values: with fewer,
// the ends of the range are close to individual values (two salaries, one PIN).
const MIN_DISTINCT_FOR_RANGE = 5;
// Formats are recognised in strings up to this length (longer ones are none of them).
const MAX_FORMAT_LENGTH = 2048;
const TYPE_ORDER = ['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'];

const FORMATS = [
  ['date-time', /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i],
  ['date', /^\d{4}-\d{2}-\d{2}$/],
  ['time', /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/],
  ['email', /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/],
  ['uri', /^[a-z][a-z0-9+.-]*:\/\/\S+$/i],
  ['uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
  ['ipv4', /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/],
  ['numeric', /^-?\d+(\.\d+)?$/],
  ['hex-color', /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i],
];
const ID_KEY = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12,}|\d{4}-\d{2}-\d{2}.*)$/i;

export function memberPath(path, key) {
  return PLAIN_KEY.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function codePointLength(text) {
  let length = text.length;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xdc00 && code <= 0xdfff && index > 0) {
      const previous = text.charCodeAt(index - 1);
      if (previous >= 0xd800 && previous <= 0xdbff) length -= 1;
    }
  }
  return length;
}

const EMAIL = FORMATS.find(([name]) => name === 'email')[1];

function looksLikeMap(keys) {
  if (keys.length > DYNAMIC_KEYS) return true;
  if (keys.length < 5) return false;
  return keys.filter((key) => ID_KEY.test(key)).length >= keys.length * 0.9;
}

/** Whether a key is data itself (an email address, a token): such keys fold into ".*", never printed as paths. */
function isDataKey(key) {
  return key.length <= MAX_FORMAT_LENGTH && (EMAIL.test(key) || looksLikeSecret(key));
}

export class OutlineBuilder {
  /** `samples`: example values to keep per path; `top`: how many of the most common values to count per path. */
  constructor({ samples = 0, top = 0 } = {}) {
    this.samples = samples;
    this.top = top;
    this.entries = new Map();
    this.roots = 0;
  }

  entry(path, parent, member, sensitive, depth) {
    let entry = this.entries.get(path);
    // Folded keys (".*") share an entry: if any of them is sensitive, the whole entry is.
    if (entry && sensitive) entry.sensitive = true;
    if (!entry) {
      entry = {
        path,
        parent,
        member,
        depth,
        sensitive,
        count: 0,
        types: {},
        formats: {},
        distinct: new Set(),
        distinctOverflow: false,
        // Value → { shown, count }, kept only when the most common values were asked for.
        tally: new Map(),
        samples: [],
        secretValues: 0,
        trueCount: 0,
        falseCount: 0,
      };
      this.entries.set(path, entry);
    }
    return entry;
  }

  /** Declares a list root (the records of a JSON Lines file) before its items are added. */
  startList(path) {
    this.entry(path, null, false, false, 0);
  }

  /** Completes a list root declared with startList, once the number of items is known. */
  endList(path, count) {
    const entry = this.entries.get(path);
    entry.count = 1;
    entry.types.array = 1;
    entry.itemsMin = count;
    entry.itemsMax = count;
  }

  /** Adds one document (or one JSON Lines record) whose root sits at `rootPath`, `rootDepth` levels deep. */
  add(root, rootPath = '$', rootParent = null, rootDepth = 0) {
    this.roots += 1;
    const stack = [{ value: root, path: rootPath, parent: rootParent, member: false, sensitive: false, depth: rootDepth }];
    while (stack.length > 0) {
      const { value, path, parent, member, sensitive, depth } = stack.pop();
      const entry = this.entry(path, parent, member, sensitive, depth);
      this.observe(entry, value);
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          stack.push({ value: value[index], path: `${path}[*]`, parent: path, member: false, sensitive: entry.sensitive, depth: depth + 1 });
        }
      } else if (isContainer(value)) {
        const keys = Object.keys(value);
        const map = looksLikeMap(keys);
        for (let index = keys.length - 1; index >= 0; index -= 1) {
          const key = keys[index];
          // A map folds all its keys; otherwise only a key that is data folds, and its siblings keep their paths.
          const folded = map || isDataKey(key);
          stack.push({
            value: value[key],
            path: folded ? `${path}.*` : memberPath(path, key),
            parent: path,
            member: !folded,
            sensitive: entry.sensitive || isSensitiveMember(value, key),
            depth: depth + 1,
          });
        }
      }
    }
  }

  range(entry, field, value, compare) {
    if (entry[`${field}Min`] === undefined || compare(value, entry[`${field}Min`]) < 0) entry[`${field}Min`] = value;
    if (entry[`${field}Max`] === undefined || compare(value, entry[`${field}Max`]) > 0) entry[`${field}Max`] = value;
  }

  /** Counts a distinct value (`key`); `sample` is how to show it, or null for one never to show. */
  remember(entry, key, sample) {
    if (!entry.distinctOverflow) {
      entry.distinct.add(key);
      if (this.top > 0 && sample !== null) {
        const tally = entry.tally.get(key);
        if (tally) tally.count += 1;
        else entry.tally.set(key, { shown: sample, count: 1 });
      }
      if (entry.distinct.size > MAX_DISTINCT) {
        entry.distinctOverflow = true;
        entry.distinct = new Set();
        entry.tally = new Map();
      }
    }
    if (sample !== null && this.samples > 0 && entry.samples.length < this.samples && !entry.sensitive && !entry.samples.includes(sample)) entry.samples.push(sample);
  }

  observe(entry, value) {
    entry.count += 1;
    const numeric = (a, b) => a - b;
    let type;
    if (value === null) {
      type = 'null';
    } else if (Array.isArray(value)) {
      type = 'array';
      this.range(entry, 'items', value.length, numeric);
    } else if (isContainer(value)) {
      type = 'object';
      this.range(entry, 'keys', Object.keys(value).length, numeric);
    } else if (typeof value === 'string') {
      type = 'string';
      this.range(entry, 'length', codePointLength(value), numeric);
      const format = value.length <= MAX_FORMAT_LENGTH ? FORMATS.find(([, pattern]) => pattern.test(value)) : undefined;
      if (format) entry.formats[format[0]] = (entry.formats[format[0]] ?? 0) + 1;
      if (looksLikeSecret(value)) {
        entry.secretValues += 1;
        this.remember(entry, `s:${value}`, null);
      } else {
        this.remember(entry, `s:${value}`, JSON.stringify(value.length > SAMPLE_LENGTH ? `${sliceText(value, SAMPLE_LENGTH - 1)}…` : value));
      }
    } else if (isNumber(value)) {
      type = isIntegerNumber(value) ? 'integer' : 'number';
      this.range(entry, 'number', value, compareNumbers);
      this.remember(entry, `n:${numberKey(value)}`, String(value));
    } else {
      type = 'boolean';
      if (value) entry.trueCount += 1;
      else entry.falseCount += 1;
    }
    entry.types[type] = (entry.types[type] ?? 0) + 1;
  }

  /** The outline: header statistics plus one row per path, in the order paths first appear. */
  result() {
    const totals = Object.fromEntries(TYPE_ORDER.map((type) => [type, 0]));
    let maxDepth = 0;
    const rows = [];
    for (const entry of this.entries.values()) {
      TYPE_ORDER.forEach((type) => {
        totals[type] += entry.types[type] ?? 0;
      });
      maxDepth = Math.max(maxDepth, entry.depth);
      rows.push(this.describe(entry));
    }
    const values = Object.values(totals).reduce((sum, count) => sum + count, 0);
    return { values, maxDepth, totals, roots: this.roots, paths: rows };
  }

  describe(entry) {
    const parent = entry.parent === null ? null : this.entries.get(entry.parent);
    // "integer" only when every number is whole: JSON has one number type, so 1840.00 and 12.5 are both "number".
    const counts = entry.types.integer && entry.types.number ? { ...entry.types, number: entry.types.number + entry.types.integer, integer: 0 } : entry.types;
    const types = TYPE_ORDER.filter((type) => counts[type]).map((type) => ({ type, count: counts[type] }));
    const strings = entry.types.string ?? 0;
    const dominant = Object.entries(entry.formats).find(([, count]) => count >= strings * 0.9);
    return {
      path: entry.path,
      depth: entry.depth,
      count: entry.count,
      presence: entry.member && parent?.types.object ? entry.count / parent.types.object : null,
      types,
      keys: entry.keysMin === undefined ? null : { min: entry.keysMin, max: entry.keysMax },
      items: entry.itemsMin === undefined ? null : { min: entry.itemsMin, max: entry.itemsMax },
      length: entry.lengthMin === undefined || entry.sensitive ? null : { min: entry.lengthMin, max: entry.lengthMax },
      // With few distinct values the ends of a range are nearly the values themselves: shown only
      // for fields with enough of them, never for sensitive fields.
      numbers:
        entry.numberMin === undefined || entry.sensitive || (!entry.distinctOverflow && entry.distinct.size < MIN_DISTINCT_FOR_RANGE)
          ? null
          : { min: String(entry.numberMin), max: String(entry.numberMax) },
      booleans: entry.types.boolean ? { true: entry.trueCount, false: entry.falseCount } : null,
      format: dominant ? dominant[0] : null,
      distinct: entry.types.string || entry.types.integer || entry.types.number ? (entry.distinctOverflow ? `${MAX_DISTINCT}+` : entry.distinct.size) : null,
      sensitive: entry.sensitive,
      secretValues: entry.secretValues,
      samples: entry.sensitive ? [] : entry.samples,
      // The most common values first (ties in the order first seen); none for sensitive fields or with too many distinct values.
      top: entry.sensitive ? [] : [...entry.tally.values()].sort((a, b) => b.count - a.count).slice(0, this.top),
    };
  }
}

/* ─── Text rendering ─── */

const number = (value) => value.toLocaleString('en-US');
const span = (range, unit) =>
  range.min === range.max ? `${number(range.min)} ${unit}${range.min === 1 ? '' : 's'}` : `${number(range.min)}–${number(range.max)} ${unit}s`;

function details(row) {
  const parts = [];
  const mixed = row.types.length > 1;
  for (const { type, count } of row.types) {
    const facts = [];
    if (type === 'object' && row.keys) facts.push(span(row.keys, 'key'));
    if (type === 'array' && row.items) facts.push(span(row.items, 'item'));
    // Sensitive fields reveal nothing about their values, not even lengths or ranges.
    if (type === 'string' && row.length && !row.sensitive) {
      if (row.format) facts.push(row.format);
      facts.push(span(row.length, 'char'));
    }
    if ((type === 'integer' || type === 'number') && row.numbers) facts.push(`${row.numbers.min} … ${row.numbers.max}`);
    if (type === 'boolean' && row.booleans) facts.push(`${number(row.booleans.true)} true · ${number(row.booleans.false)} false`);
    if (mixed) parts.push(`${type} ${Math.round((count / row.count) * 100)}%${facts.length ? ` (${facts.join(', ')})` : ''}`);
    else parts.push(...facts);
  }
  if (row.distinct !== null && row.count > 1) parts.push(row.distinct === row.count ? 'all distinct' : `${typeof row.distinct === 'number' ? number(row.distinct) : row.distinct} distinct`);
  if (row.sensitive) parts.push('sensitive: values hidden');
  else if (row.secretValues > 0) parts.push(`${number(row.secretValues)} secret-looking value${row.secretValues === 1 ? '' : 's'} hidden`);
  if (row.samples.length > 0) parts.push(`e.g. ${row.samples.join(', ')}`);
  if (row.top.length > 0) parts.push(`most common: ${row.top.map(({ shown, count }) => `${shown} ×${number(count)}`).join(', ')}`);
  return parts.filter(Boolean).join(' · ');
}

function seen(row) {
  if (row.presence === null) return number(row.count);
  const percent = row.presence * 100;
  const rounded = percent === 100 ? '100%' : percent >= 99.5 ? '>99%' : percent < 0.5 ? '<1%' : `${Math.round(percent)}%`;
  return percent === 100 ? rounded : `${rounded} (${number(row.count)})`;
}

/** Renders an outline as aligned text rows. `maxPaths` limits the rows (the rest are summarized). */
export function renderOutline(result, { maxPaths = 200, depth = Infinity } = {}) {
  const rows = result.paths.filter((row) => row.depth <= depth);
  const shown = rows.slice(0, maxPaths);
  const typeLabel = (row) => row.types.map(({ type }) => type).join('|');
  const pathWidth = Math.min(56, Math.max(4, ...shown.map((row) => row.path.length)));
  const typeWidth = Math.max(4, ...shown.map((row) => typeLabel(row).length));
  const seenWidth = Math.max(4, ...shown.map((row) => seen(row).length));
  const lines = [`${'PATH'.padEnd(pathWidth)}  ${'TYPE'.padEnd(typeWidth)}  ${'SEEN'.padEnd(seenWidth)}  DETAILS`];
  shown.forEach((row) => {
    lines.push(`${row.path.padEnd(pathWidth)}  ${typeLabel(row).padEnd(typeWidth)}  ${seen(row).padEnd(seenWidth)}  ${details(row)}`.trimEnd());
  });
  const hiddenByDepth = result.paths.length - rows.length;
  const more = rows.length - shown.length;
  if (more > 0) lines.push(`… ${number(more)} more path${more === 1 ? '' : 's'} (use --path to focus on a part, --depth to limit nesting, or --max-paths).`);
  if (hiddenByDepth > 0) lines.push(`… ${number(hiddenByDepth)} deeper path${hiddenByDepth === 1 ? '' : 's'} hidden by --depth.`);
  return lines.join('\n');
}
