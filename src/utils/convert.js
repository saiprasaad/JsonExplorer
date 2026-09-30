import { isContainer, isIntegerNumber, isNumber, stringifyJson } from './json';

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/* ─── Shape inference (shared by TypeScript and JSON Schema) ─── */

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Domain labels without dots, so a long run of "a.a.a…" cannot make the match backtrack.
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const URI = /^https?:\/\/\S+$/i;

function stringShape(value) {
  return {
    kind: 'string',
    dateTime: ISO_DATE_TIME.test(value),
    date: ISO_DATE.test(value),
    email: EMAIL.test(value),
    uri: URI.test(value),
  };
}

/** Describes the structure of a value; arrays merge the shapes of all their items. */
export function inferShape(value) {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'string') return stringShape(value);
  if (isNumber(value)) return { kind: isIntegerNumber(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (Array.isArray(value)) {
    let items = null;
    value.forEach((item) => {
      items = items ? mergeShapes(items, inferShape(item)) : inferShape(item);
    });
    return { kind: 'array', items };
  }
  const props = new Map();
  for (const key in value) {
    if (hasOwn(value, key)) props.set(key, { shape: inferShape(value[key]), count: 1 });
  }
  return { kind: 'object', props, count: 1 };
}

// Merges `b` into `a`, reusing (and mutating) `a` where possible: shapes are built fresh for one
// inference pass and each is owned by a single parent, so copying would only cost time (quadratic
// for arrays of records with many distinct keys).
function mergeShapes(a, b) {
  if (a.kind === 'union' || b.kind === 'union') {
    const options = [...(a.kind === 'union' ? a.options : [a])];
    (b.kind === 'union' ? b.options : [b]).forEach((option) => addOption(options, option));
    return options.length === 1 ? options[0] : { kind: 'union', options };
  }
  if (a.kind === b.kind) {
    if (a.kind === 'object') {
      b.props.forEach((prop, key) => {
        const existing = a.props.get(key);
        if (existing) {
          existing.shape = mergeShapes(existing.shape, prop.shape);
          existing.count += prop.count;
        } else {
          a.props.set(key, prop);
        }
      });
      a.count += b.count;
      return a;
    }
    if (a.kind === 'array') {
      return { kind: 'array', items: a.items && b.items ? mergeShapes(a.items, b.items) : a.items || b.items };
    }
    if (a.kind === 'string') {
      return { kind: 'string', dateTime: a.dateTime && b.dateTime, date: a.date && b.date, email: a.email && b.email, uri: a.uri && b.uri };
    }
    return a;
  }
  if ((a.kind === 'integer' && b.kind === 'number') || (a.kind === 'number' && b.kind === 'integer')) {
    return { kind: 'number' };
  }
  const options = [a];
  addOption(options, b);
  return { kind: 'union', options };
}

function addOption(options, option) {
  const index = options.findIndex(
    (candidate) =>
      candidate.kind === option.kind ||
      (['integer', 'number'].includes(candidate.kind) && ['integer', 'number'].includes(option.kind))
  );
  if (index === -1) options.push(option);
  else options[index] = mergeShapes(options[index], option);
}

/* ─── TypeScript ─── */

const TS_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
// Global types a generated interface must not shadow (importing an interface named Record breaks
// every Record<K, V> in that file).
const GLOBAL_TYPES = new Set(
  (
    'Array ArrayBuffer Attr Audio Awaited BigInt Blob Boolean Buffer Capitalize Comment Console Crypto CSS DataView Date Document ' +
    'Element Error Event EventTarget Exclude Extract File FormData Function Generator Headers History Image InstanceType Intl ' +
    'Iterator JSON Location Lowercase Map Math Navigator Node NonNullable Notification Number Object Omit Option Parameters ' +
    'Partial Performance Pick Promise Proxy Range Readonly ReadonlyArray Record Reflect RegExp Request Required Response ' +
    'ReturnType Screen Selection Set Storage String Symbol Text ThisType Uncapitalize Uppercase URL Window Worker WeakMap WeakSet'
  ).split(' ')
);

/** A type name that does not shadow a global type: "Error" becomes "ErrorData". */
export function safeTypeName(name, suffix = 'Data') {
  return GLOBAL_TYPES.has(name) ? `${name}${suffix}` : name;
}

export function pascalCase(text) {
  const words = String(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
  if (!name) return 'Item';
  return /^\d/.test(name) ? `T${name}` : name;
}

export function singularize(name) {
  if (/ies$/.test(name) && name.length > 4) return `${name.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(name)) return name;
  if (/(ches|shes|xes|ses)$/.test(name)) return name.slice(0, -2);
  if (/s$/.test(name) && name.length > 3) return name.slice(0, -1);
  return name;
}

/**
 * Generates TypeScript interfaces describing `value`. With `records`, `value` is a list of
 * records (e.g. JSON Lines) and the root type describes one record.
 */
export function toTypeScript(value, rootName = 'Root', { records = false } = {}) {
  // Declarations are reserved before their children are visited so parents print first.
  const declarations = [];
  const bySignature = new Map();
  const usedNames = new Set([rootName]);

  const uniqueName = (base) => {
    let name = safeTypeName(base);
    let suffix = 2;
    while (usedNames.has(name)) name = `${base}${suffix++}`;
    usedNames.add(name);
    return name;
  };

  const typeOf = (shape, nameHint, isRoot = false) => {
    switch (shape?.kind) {
      case undefined:
        return 'unknown';
      case 'string':
      case 'boolean':
      case 'null':
        return shape.kind;
      case 'integer':
      case 'number':
        return 'number';
      case 'array': {
        const item = typeOf(shape.items, isRoot ? `${rootName}Item` : singularize(nameHint));
        return /[|\s]/.test(item) ? `(${item})[]` : `${item}[]`;
      }
      case 'union':
        return shape.options.map((option) => typeOf(option, nameHint)).join(' | ');
      default: {
        const index = declarations.length;
        const declaration = { name: null, text: '' };
        declarations.push(declaration);
        const lines = [];
        shape.props.forEach((prop, key) => {
          const optional = prop.count < shape.count ? '?' : '';
          const propertyName = TS_IDENTIFIER.test(key) ? key : JSON.stringify(key);
          // A field that is always null says nothing about its real type: flag it for the reader.
          const note = prop.shape.kind === 'null' ? ' // only null in the sample' : '';
          lines.push(`  ${propertyName}${optional}: ${typeOf(prop.shape, pascalCase(key))};${note}`);
        });
        const body = lines.join('\n');
        if (!isRoot && bySignature.has(body)) {
          declarations.splice(index, 1);
          return bySignature.get(body);
        }
        const name = isRoot ? rootName : uniqueName(pascalCase(nameHint));
        bySignature.set(body, name);
        declaration.name = name;
        declaration.text = lines.length ? `export interface ${name} {\n${body}\n}` : `export interface ${name} {}`;
        return name;
      }
    }
  };

  const shape = inferShape(value);
  const rootType = typeOf(records && shape.kind === 'array' ? shape.items : shape, rootName, true);
  const blocks = declarations.filter((declaration) => declaration.name).map((declaration) => declaration.text);
  if (rootType !== rootName) blocks.unshift(`export type ${rootName} = ${rootType};`);
  return `${blocks.join('\n\n')}\n`;
}

/* ─── JSON Schema ─── */

function schemaOf(shape) {
  switch (shape?.kind) {
    case undefined:
      return {};
    case 'string': {
      const schema = { type: 'string' };
      if (shape.dateTime) schema.format = 'date-time';
      else if (shape.date) schema.format = 'date';
      else if (shape.email) schema.format = 'email';
      else if (shape.uri) schema.format = 'uri';
      return schema;
    }
    case 'array':
      return shape.items ? { type: 'array', items: schemaOf(shape.items) } : { type: 'array' };
    case 'union': {
      const schemas = shape.options.map(schemaOf);
      const simple = schemas.every((schema) => Object.keys(schema).length === 1 && typeof schema.type === 'string');
      return simple ? { type: schemas.map((schema) => schema.type) } : { anyOf: schemas };
    }
    case 'object': {
      // No prototype, so a "__proto__" key becomes a property instead of replacing the prototype.
      const properties = Object.create(null);
      const required = [];
      shape.props.forEach((prop, key) => {
        properties[key] = schemaOf(prop.shape);
        if (prop.count === shape.count) required.push(key);
      });
      return { type: 'object', properties, ...(required.length ? { required } : {}) };
    }
    default:
      return { type: shape.kind };
  }
}

/** Infers a JSON Schema (draft 2020-12) from a sample value (with `records`, from a list of records). */
export function toJsonSchema(value, title, { records = false } = {}) {
  const shape = inferShape(value);
  const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...(title ? { title } : {}), ...schemaOf(records && shape.kind === 'array' ? shape.items : shape) };
  return `${JSON.stringify(schema, null, 2)}\n`;
}

/* ─── YAML ─── */

// Plain scalars that YAML 1.1/1.2 parsers would read as something other than a string: booleans,
// nulls, merge keys (<<), PyYAML's value key (=), numbers, infinities and NaN.
const YAML_RESERVED = /^(?:true|false|yes|no|on|off|y|n|null|~|<<|=)$/i;
const YAML_NUMBER_LIKE = /^(?:[-+]?(?:\d|\.\d|\.inf)|\.nan)/i;
// Implicit keys may be at most 1024 characters; longer keys use the explicit `? key` form.
const MAX_IMPLICIT_KEY = 1000;
const YAML_ESCAPES = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\t': '\\t', '\r': '\\r' };

/** Code points YAML only allows escaped: C0/C1 controls, DEL, line/paragraph separators, BOM, non-characters, lone surrogates. */
function needsYamlEscape(code) {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0xfeff ||
    code === 0xfffe ||
    code === 0xffff ||
    (code >= 0xd800 && code <= 0xdfff)
  );
}

function yamlQuoted(text) {
  let out = '"';
  for (const char of text) {
    const code = char.codePointAt(0);
    if (YAML_ESCAPES[char]) out += YAML_ESCAPES[char];
    else if (needsYamlEscape(code)) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += char;
  }
  return `${out}"`;
}

function isPlainYaml(text) {
  if (text === '' || text !== text.trim()) return false;
  // Indicator characters, and document markers (--- is caught by the leading '-').
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text) || text.startsWith('...')) return false;
  if (text.includes(': ') || text.includes(' #') || text.endsWith(':')) return false;
  if (YAML_RESERVED.test(text) || YAML_NUMBER_LIKE.test(text)) return false;
  for (const char of text) {
    if (needsYamlEscape(char.codePointAt(0))) return false;
  }
  return true;
}

function yamlScalarString(text) {
  return isPlainYaml(text) ? text : yamlQuoted(text);
}

// YAML 1.1 parsers (PyYAML) only read exponent floats with a dot and a signed exponent: 1e21 → 1.0e+21.
const EXPONENT_NUMBER = /^(-?\d+)(\.\d+)?[eE]([+-]?)(\d+)$/;

function yamlScalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return yamlScalarString(value);
  const text = String(value);
  const exponent = isNumber(value) ? EXPONENT_NUMBER.exec(text) : null;
  return exponent ? `${exponent[1]}${exponent[2] || '.0'}e${exponent[3] || '+'}${exponent[4]}` : text;
}

function isEmptyContainer(value) {
  return isContainer(value) && (Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0);
}

/** Serializes `value` as block-style YAML. */
export function toYaml(value) {
  const lines = [];
  const inline = (item) => (Array.isArray(item) ? '[]' : isContainer(item) ? '{}' : yamlScalar(item));

  const emit = (item, indent, prefix) => {
    const pad = ' '.repeat(indent);
    if (!isContainer(item) || isEmptyContainer(item)) {
      lines.push(`${prefix}${inline(item)}`);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((element, index) => {
        const head = index === 0 ? prefix : pad;
        if (isContainer(element) && !isEmptyContainer(element)) emit(element, indent + 2, `${head}- `);
        else lines.push(`${head}- ${inline(element)}`);
      });
      return;
    }
    Object.keys(item).forEach((key, index) => {
      const head = index === 0 ? prefix : pad;
      const child = item[key];
      const keyText = yamlScalarString(key);
      const nested = isContainer(child) && !isEmptyContainer(child);
      if (keyText.length > MAX_IMPLICIT_KEY) {
        lines.push(`${head}? ${keyText}`);
        if (nested) {
          lines.push(`${pad}:`);
          emit(child, indent + 2, ' '.repeat(indent + 2));
        } else {
          lines.push(`${pad}: ${inline(child)}`);
        }
      } else if (nested) {
        lines.push(`${head}${keyText}:`);
        emit(child, indent + 2, ' '.repeat(indent + 2));
      } else {
        lines.push(`${head}${keyText}: ${inline(child)}`);
      }
    });
  };

  emit(value, 0, '');
  return `${lines.join('\n')}\n`;
}

/* ─── Tables & CSV ─── */

// Column names are unambiguous paths: plain keys join with dots, and keys that are empty or contain
// '.', '[', ']' or '"' are bracket-quoted — owner.name, meta["a.b"], [""] — so no two collide.
const PLAIN_COLUMN_KEY = /^[^.[\]"]+$/;

function columnName(prefix, key) {
  if (!PLAIN_COLUMN_KEY.test(key)) return `${prefix}[${JSON.stringify(key)}]`;
  return prefix ? `${prefix}.${key}` : key;
}

function flatten(value, prefix, target) {
  if (isContainer(value) && !Array.isArray(value) && !isEmptyContainer(value)) {
    Object.keys(value).forEach((key) => flatten(value[key], columnName(prefix, key), target));
  } else {
    target.set(prefix || 'value', value);
  }
  return target;
}

/**
 * Turns an array of records (or a dictionary of records) into rows and columns. Nested objects
 * become dotted columns (`owner.name`); arrays stay as JSON. Returns null for non-tabular values.
 */
export function tabulate(value) {
  let entries;
  let keyed = false;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    entries = value.map((item, index) => [index, item]);
  } else if (isContainer(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return null;
    keyed = keys.every((key) => isContainer(value[key]) && !Array.isArray(value[key]));
    entries = keyed ? keys.map((key) => [key, value[key]]) : [[0, value]];
  } else {
    return null;
  }

  const columns = [];
  const seen = new Set();
  const flattened = entries.map(([key, item]) => {
    const cells = Array.isArray(item) ? new Map(item.map((cell, index) => [String(index), cell])) : flatten(item, '', new Map());
    cells.forEach((_, column) => {
      if (!seen.has(column)) {
        seen.add(column);
        columns.push(column);
      }
    });
    return { key, cells };
  });
  const cellsOf = (cells) => columns.map((column) => (cells.has(column) ? cells.get(column) : undefined));

  if (!keyed) return { columns, keyed, rows: flattened.map(({ key, cells }) => ({ key, values: cellsOf(cells) })) };
  // Dictionary keys go in a first column, named so it cannot shadow a field of the records.
  let keyColumn = 'key';
  for (let suffix = 1; seen.has(keyColumn); suffix += 1) keyColumn = suffix === 1 ? '(key)' : `(key ${suffix})`;
  return {
    columns: [keyColumn, ...columns],
    keyed,
    rows: flattened.map(({ key, cells }) => ({ key, values: [key, ...cellsOf(cells)] })),
  };
}

/** True when a value reads naturally as a table: a non-empty array or a dictionary of records. */
export function isTabular(value) {
  if (Array.isArray(value)) return value.length > 0;
  const table = isContainer(value) ? tabulate(value) : null;
  return Boolean(table?.keyed);
}

function csvCell(value, delimiter) {
  if (value === undefined || value === null) return '';
  let text = isContainer(value) ? stringifyJson(value) : String(value);
  // Neutralise spreadsheet formulas (CSV injection) in text cells, also after leading whitespace,
  // which some spreadsheets trim when they import a file.
  if (typeof value === 'string' && /^(?:\s*[=+\-@]|[\t\r])/.test(text)) text = `'${text}`;
  return /["\r\n]|^\s|\s$/.test(text) || text.includes(delimiter) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV (RFC 4180, CRLF line endings) for an array or dictionary of records; `delimiter` makes TSV etc. */
export function toCsv(value, { delimiter = ',' } = {}) {
  const table = tabulate(value);
  if (!table) {
    throw new Error('CSV needs an array (or a dictionary) of records — select an array such as a list of items.');
  }
  const lines = [table.columns.map((cell) => csvCell(cell, delimiter)).join(delimiter)];
  table.rows.forEach((row) => lines.push(row.values.map((cell) => csvCell(cell, delimiter)).join(delimiter)));
  return `${lines.join('\r\n')}\r\n`;
}

export const CONVERTERS = [
  { id: 'typescript', label: 'TypeScript', extension: 'ts', mime: 'text/plain', convert: (value, name) => toTypeScript(value, name) },
  { id: 'schema', label: 'JSON Schema', extension: 'schema.json', mime: 'application/json', convert: (value, name) => toJsonSchema(value, name) },
  { id: 'yaml', label: 'YAML', extension: 'yaml', mime: 'application/yaml', convert: (value) => toYaml(value) },
  { id: 'csv', label: 'CSV', extension: 'csv', mime: 'text/csv', convert: (value) => toCsv(value) },
];
