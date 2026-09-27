import { isContainer } from './json';

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/* ─── Shape inference (shared by TypeScript and JSON Schema) ─── */

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  if (typeof value === 'number') return { kind: Number.isInteger(value) ? 'integer' : 'number' };
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

function mergeShapes(a, b) {
  if (a.kind === 'union' || b.kind === 'union') {
    const options = [...(a.kind === 'union' ? a.options : [a])];
    (b.kind === 'union' ? b.options : [b]).forEach((option) => addOption(options, option));
    return options.length === 1 ? options[0] : { kind: 'union', options };
  }
  if (a.kind === b.kind) {
    if (a.kind === 'object') {
      const props = new Map(a.props);
      b.props.forEach((prop, key) => {
        const existing = props.get(key);
        props.set(key, existing ? { shape: mergeShapes(existing.shape, prop.shape), count: existing.count + prop.count } : prop);
      });
      return { kind: 'object', props, count: a.count + b.count };
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

function pascalCase(text) {
  const words = String(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
  if (!name) return 'Item';
  return /^\d/.test(name) ? `T${name}` : name;
}

function singularize(name) {
  if (/ies$/.test(name) && name.length > 4) return `${name.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(name)) return name;
  if (/(ches|shes|xes|ses)$/.test(name)) return name.slice(0, -2);
  if (/s$/.test(name) && name.length > 3) return name.slice(0, -1);
  return name;
}

/** Generates TypeScript interfaces describing `value`. */
export function toTypeScript(value, rootName = 'Root') {
  // Declarations are reserved before their children are visited so parents print first.
  const declarations = [];
  const bySignature = new Map();
  const usedNames = new Set([rootName]);

  const uniqueName = (base) => {
    let name = base;
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
          lines.push(`  ${propertyName}${optional}: ${typeOf(prop.shape, pascalCase(key))};`);
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

  const rootType = typeOf(inferShape(value), rootName, true);
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
      const properties = {};
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

/** Infers a JSON Schema (draft 2020-12) from a sample value. */
export function toJsonSchema(value, title) {
  const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...(title ? { title } : {}), ...schemaOf(inferShape(value)) };
  return `${JSON.stringify(schema, null, 2)}\n`;
}

/* ─── YAML ─── */

const YAML_RESERVED = /^(?:true|false|yes|no|on|off|y|n|null|~)$/i;
const YAML_NUMBER_LIKE = /^(?:[-+]?(?:\d|\.\d)|0x|0o|\.inf|-\.inf|\.nan)/i;

function hasControlCharacter(text) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function yamlScalarString(text) {
  const plain =
    text !== '' &&
    text === text.trim() &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(text) &&
    !hasControlCharacter(text) &&
    !text.includes(': ') &&
    !text.includes(' #') &&
    !text.endsWith(':') &&
    !YAML_RESERVED.test(text) &&
    !YAML_NUMBER_LIKE.test(text);
  return plain ? text : JSON.stringify(text);
}

function yamlScalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return yamlScalarString(value);
  return String(value);
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
      if (isContainer(child) && !isEmptyContainer(child)) {
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

function flatten(value, prefix, target) {
  if (isContainer(value) && !Array.isArray(value) && !isEmptyContainer(value)) {
    Object.keys(value).forEach((key) => flatten(value[key], prefix ? `${prefix}.${key}` : key, target));
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
  let keyColumn = null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    entries = value.map((item, index) => [index, item]);
  } else if (isContainer(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return null;
    const records = keys.every((key) => isContainer(value[key]) && !Array.isArray(value[key]));
    if (records) {
      entries = keys.map((key) => [key, value[key]]);
      keyColumn = 'key';
    } else {
      entries = [[0, value]];
    }
  } else {
    return null;
  }

  const columns = keyColumn ? [keyColumn] : [];
  const seen = new Set(columns);
  const flattened = entries.map(([key, item]) => {
    const cells = Array.isArray(item) ? new Map(item.map((cell, index) => [String(index), cell])) : flatten(item, '', new Map());
    if (keyColumn) cells.set(keyColumn, key);
    cells.forEach((_, column) => {
      if (!seen.has(column)) {
        seen.add(column);
        columns.push(column);
      }
    });
    return { key, cells };
  });

  return {
    columns,
    keyed: keyColumn !== null,
    rows: flattened.map(({ key, cells }) => ({ key, values: columns.map((column) => (cells.has(column) ? cells.get(column) : undefined)) })),
  };
}

/** True when a value reads naturally as a table: a non-empty array or a dictionary of records. */
export function isTabular(value) {
  if (Array.isArray(value)) return value.length > 0;
  const table = isContainer(value) ? tabulate(value) : null;
  return Boolean(table?.keyed);
}

function csvCell(value) {
  if (value === undefined || value === null) return '';
  let text = isContainer(value) ? JSON.stringify(value) : String(value);
  // Neutralise spreadsheet formulas (CSV injection) in text cells.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(value) {
  const table = tabulate(value);
  if (!table) {
    throw new Error('CSV needs an array (or a dictionary) of records — select an array such as a list of items.');
  }
  const lines = [table.columns.map(csvCell).join(',')];
  table.rows.forEach((row) => lines.push(row.values.map(csvCell).join(',')));
  return `${lines.join('\r\n')}\r\n`;
}

export const CONVERTERS = [
  { id: 'typescript', label: 'TypeScript', extension: 'ts', mime: 'text/plain', convert: (value, name) => toTypeScript(value, name) },
  { id: 'schema', label: 'JSON Schema', extension: 'schema.json', mime: 'application/json', convert: (value, name) => toJsonSchema(value, name) },
  { id: 'yaml', label: 'YAML', extension: 'yaml', mime: 'application/yaml', convert: (value) => toYaml(value) },
  { id: 'csv', label: 'CSV', extension: 'csv', mime: 'text/csv', convert: (value) => toCsv(value) },
];
