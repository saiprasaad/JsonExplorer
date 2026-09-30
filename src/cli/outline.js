import { compareNumbers, isContainer, isIntegerNumber, isNumber, numberKey, sliceText } from '../utils/json';
import { isSensitiveMember, looksLikeSecret } from './redact';

/*
 * A structural summary of a document: every distinct path (array items folded into [*], the keys
 * of maps into .*), its types, how often it is present, and value statistics (lengths, formats,
 * ranges, cardinality). Raw values are only included on request (samples, the most common
 * values), and never for secret-looking fields.
 */

const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Maps are objects whose keys are data (ids, names, dates) rather than field names; their keys
// fold into ".*". An object is a map with at least SAME_SHAPE_KEYS keys whose values are objects of
// one shape (users by name) or lists, more than DYNAMIC_KEYS keys whose values have one type, at
// least ID_KEYS keys nearly all ids, or more than MAX_KEYS keys. Where objects repeat (list items,
// records), the keys tell: a path is a map when, after MIN_INSTANCES objects, more than
// DYNAMIC_KEYS different keys have come and most came only once, as names do and fields do not.
const SAME_SHAPE_KEYS = 20;
const DYNAMIC_KEYS = 64;
const ID_KEYS = 5;
const MAX_KEYS = 1000;
const MIN_INSTANCES = 8;
// After this many objects without a sign of a map, a path's keys are those of records: no longer tracked.
const SETTLED_INSTANCES = 1000;
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
// Ids: numbers, uuids, hashes, dates, and ids with a short prefix (u1001, SKU-12345, cus_N3fFrFe8).
const ID_KEY = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12,}|\d{4}-\d{2}-\d{2}.*|[a-z]{1,8}[_-]?\d{3,}|[a-z]{1,8}_(?=[a-z]*\d)[a-z0-9]{8,})$/i;

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

/** Whether nearly all of an object's keys (at least ID_KEYS of them) are ids. */
const keyedByIds = (keys) => keys.length >= ID_KEYS && keys.filter((key) => ID_KEY.test(key)).length >= keys.length * 0.9;

/** A value's type, for telling maps (values alike) from records; numbers are one type. */
function shapeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (isContainer(value)) return 'object';
  return isNumber(value) ? 'number' : typeof value;
}

/**
 * Whether an object's values are alike enough for a map, judged from the object alone: at least
 * SAME_SHAPE_KEYS values that are lists, or objects of one kind (all their keys together at most
 * twice as many as one has on average, or one key in 80% of them, as `version` is in the packages
 * of a lockfile), or more than DYNAMIC_KEYS values of one type. Nulls aside.
 */
function valuesAlike(object, keys) {
  if (keys.length < SAME_SHAPE_KEYS) return false;
  const shapes = new Set();
  const names = new Map();
  let objects = 0;
  let members = 0;
  let common = 0; // how many of the objects have the most common key
  for (const key of keys) {
    const value = object[key];
    const shape = shapeOf(value);
    if (shape === 'null') continue;
    shapes.add(shape);
    if (shapes.size > 1) return false;
    if (shape === 'object') {
      const inner = Object.keys(value);
      objects += 1;
      members += inner.length;
      for (const name of inner) {
        const count = (names.get(name) ?? 0) + 1;
        names.set(name, count);
        common = Math.max(common, count);
      }
    }
  }
  if (shapes.has('object')) return names.size <= Math.max(1, (2 * members) / objects) || common >= objects * 0.8;
  return shapes.has('array') || (shapes.size === 1 && keys.length > DYNAMIC_KEYS);
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
    // Paths found to be maps; for paths that repeat, the keys seen so far (see keysKeepChanging).
    this.maps = new Set();
    this.keysSeen = new Map();
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

  /**
   * Adds one document, JSON Lines record or --path match. `path` is where it sits ($[*] for records
   * under a list root declared with startList) and `depth` how deep; `repeated` says that more
   * values come at the same path (records, several matches). `key` is the name it sits under and
   * `sensitive` whether a name above it is sensitive, so that an outline of part of a document
   * keeps its secrets as well as an outline of the whole.
   */
  add(root, { path = '$', parent = null, depth = 0, repeated = false, key, sensitive = false } = {}) {
    this.roots += 1;
    const stack = [{ value: root, path, parent, member: false, depth, repeated, key, sensitive }];
    while (stack.length > 0) {
      const item = stack.pop();
      const entry = this.entry(item.path, item.parent, item.member, item.sensitive, item.depth);
      this.observe(entry, item.value, item.key);
      if (Array.isArray(item.value)) {
        for (let index = item.value.length - 1; index >= 0; index -= 1) {
          // Items repeat, and go by their list's name (the items of orderIds are order ids).
          stack.push({ value: item.value[index], path: `${item.path}[*]`, parent: item.path, member: false, depth: item.depth + 1, repeated: true, key: item.key, sensitive: entry.sensitive });
        }
      } else if (isContainer(item.value)) {
        const keys = Object.keys(item.value);
        const map = this.isMap(item.path, item.value, keys, item.repeated);
        for (let index = keys.length - 1; index >= 0; index -= 1) {
          const name = keys[index];
          // A map folds all its keys; otherwise only a key that is data folds, and its siblings keep their paths.
          const folded = map || isDataKey(name);
          stack.push({
            value: item.value[name],
            path: folded ? `${item.path}.*` : memberPath(item.path, name),
            parent: item.path,
            member: !folded,
            depth: item.depth + 1,
            repeated: item.repeated || folded,
            key: name,
            sensitive: entry.sensitive || isSensitiveMember(item.value, name),
          });
        }
      }
    }
  }

  /** Whether the object at `path` is a map. A path found to be one stays one, and what its keys held so far folds too. */
  isMap(path, object, keys, repeated) {
    if (this.maps.has(path)) return true;
    const map = keys.length > MAX_KEYS || keyedByIds(keys) || (repeated ? this.keysKeepChanging(path, object, keys) : valuesAlike(object, keys));
    // A path that does not repeat is met once, with nothing outlined under it yet.
    if (map && repeated) this.foldPath(path);
    else if (map) this.maps.add(path);
    return map;
  }

  /**
   * Whether the keys at a path that repeats keep changing from one object to the next, as names
   * and ids do (the fields of records recur): see DYNAMIC_KEYS. Values must have one type, too.
   */
  keysKeepChanging(path, object, keys) {
    let seen = this.keysSeen.get(path);
    if (seen === null) return false;
    if (!seen) {
      seen = { instances: 0, occurrences: 0, keys: new Set(), shapes: new Set() };
      this.keysSeen.set(path, seen);
    }
    seen.instances += 1;
    seen.occurrences += keys.length;
    for (const key of keys) {
      seen.keys.add(key);
      const shape = shapeOf(object[key]);
      if (shape !== 'null') seen.shapes.add(shape);
    }
    const distinct = seen.keys.size;
    if (distinct > MAX_KEYS) return true;
    if (seen.instances >= MIN_INSTANCES && distinct > DYNAMIC_KEYS && distinct * 2 > seen.occurrences && seen.shapes.size === 1) return true;
    // Settled: keys that recur are the fields of records. null marks the path as no longer tracked.
    if (seen.instances >= SETTLED_INSTANCES && distinct * 2 <= seen.occurrences) this.keysSeen.set(path, null);
    return false;
  }

  /**
   * Makes `path` a map: its keys fold into "path.*" from now on, and everything already outlined
   * under one of its keys (from earlier objects at the path) moves there, merged with what is
   * there, in the place of the first of them.
   */
  foldPath(path) {
    this.maps.add(path);
    this.keysSeen.delete(path);
    const folded = `${path}.*`;
    // For each entry, the member of `path` it sits under (itself or an ancestor), worked out before anything moves.
    const memberOf = (entry) => {
      let current = entry;
      while (current && current.parent !== path) current = this.entries.get(current.parent);
      return current?.member ? current : null;
    };
    const plan = [...this.entries.values()].map((entry) => {
      const member = memberOf(entry);
      return { entry, prefix: member?.path, isMember: entry === member };
    });
    const entries = new Map();
    for (const { entry, prefix, isMember } of plan) {
      if (prefix === undefined) {
        entries.set(entry.path, entry);
        continue;
      }
      const target = `${folded}${entry.path.slice(prefix.length)}`;
      if (this.maps.has(entry.path)) this.maps.add(target);
      this.keysSeen.delete(entry.path);
      const into = entries.get(target) ?? this.entries.get(target);
      if (into) {
        this.absorb(into, entry);
        entries.set(target, into);
      } else {
        const parent = isMember ? path : `${folded}${entry.parent.slice(prefix.length)}`;
        Object.assign(entry, { path: target, parent, member: isMember ? false : entry.member });
        entries.set(target, entry);
      }
    }
    this.entries = entries;
  }

  /** Adds what `source` recorded to `target`, when two paths become one. */
  absorb(target, source) {
    target.count += source.count;
    target.sensitive = target.sensitive || source.sensitive;
    target.secretValues += source.secretValues;
    target.trueCount += source.trueCount;
    target.falseCount += source.falseCount;
    Object.entries(source.types).forEach(([type, count]) => {
      target.types[type] = (target.types[type] ?? 0) + count;
    });
    Object.entries(source.formats).forEach(([format, count]) => {
      target.formats[format] = (target.formats[format] ?? 0) + count;
    });
    ['keys', 'items', 'length', 'number'].forEach((field) => {
      if (source[`${field}Min`] === undefined) return;
      const compare = field === 'number' ? compareNumbers : (a, b) => a - b;
      this.range(target, field, source[`${field}Min`], compare);
      this.range(target, field, source[`${field}Max`], compare);
    });
    if (source.distinctOverflow) this.overflow(target);
    if (!target.distinctOverflow) {
      source.distinct.forEach((key) => target.distinct.add(key));
      source.tally.forEach(({ shown, count }, key) => {
        const tally = target.tally.get(key);
        if (tally) tally.count += count;
        else target.tally.set(key, { shown, count });
      });
      if (target.distinct.size > MAX_DISTINCT) this.overflow(target);
    }
    source.samples.forEach((sample) => {
      if (target.samples.length < this.samples && !target.samples.includes(sample)) target.samples.push(sample);
    });
  }

  /** Stops counting distinct values once there are too many to be useful (or to keep). */
  overflow(entry) {
    entry.distinctOverflow = true;
    entry.distinct = new Set();
    entry.tally = new Map();
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
      if (entry.distinct.size > MAX_DISTINCT) this.overflow(entry);
    }
    if (sample !== null && this.samples > 0 && entry.samples.length < this.samples && !entry.sensitive && !entry.samples.includes(sample)) entry.samples.push(sample);
  }

  /** Records one value at the entry's path; `key` is the name it sits under (see looksLikeSecret). */
  observe(entry, value, key) {
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
      if (looksLikeSecret(value, key)) {
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
      // The most common values first (ties in the order first seen), only those seen more than once:
      // one seen once says nothing common and would show a single record. None for sensitive
      // fields or with too many distinct values.
      top: entry.sensitive
        ? []
        : [...entry.tally.values()]
            .filter(({ count }) => count > 1)
            .sort((a, b) => b.count - a.count)
            .slice(0, this.top),
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
  // true, false and null are shown even under a sensitive name, as query shows them: they are no secret.
  if (row.sensitive && row.types.some(({ type }) => type !== 'boolean' && type !== 'null')) parts.push('sensitive: values hidden');
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
