import Ajv from 'ajv';
import Ajv2019 from 'ajv/dist/2019';
import Ajv2020 from 'ajv/dist/2020';
import draft06 from 'ajv/dist/refs/json-schema-draft-06.json';
import addFormats from 'ajv-formats';
import { formatPath } from '../utils/json';
import { InputError } from './io';

/*
 * JSON Schema validation with Ajv: draft-06, draft-07, 2019-09 and 2020-12, chosen from the
 * schema's "$schema" (draft-07 when it has none), with the standard formats (email, date-time, …).
 */

/** Compiles a schema object into a validate function. Throws InputError for unusable schemas. */
export function compileSchema(schema, name) {
  const isObject = typeof schema === 'object' && schema !== null && !Array.isArray(schema);
  if (!isObject && typeof schema !== 'boolean') throw new InputError(`${name} is not a JSON Schema (it must be an object or a boolean).`);
  const uri = typeof schema?.$schema === 'string' ? schema.$schema : '';
  if (/draft-0[34]\b/.test(uri)) throw new InputError(`${name} uses JSON Schema ${uri.match(/draft-0[34]/)[0]}, which is not supported. Use draft-06 or later.`);
  const Validator = /2020-12/.test(uri) ? Ajv2020 : /2019-09/.test(uri) ? Ajv2019 : Ajv;
  // multipleOfPrecision: 0.07 is a multiple of 0.01 (in floating point, 0.07 / 0.01 is 7.000000000000001).
  const ajv = new Validator({ allErrors: true, strict: false, validateFormats: true, multipleOfPrecision: 9 });
  addFormats(ajv);
  if (/draft-06/.test(uri)) ajv.addMetaSchema(draft06);
  try {
    return ajv.compile(schema);
  } catch (error) {
    throw new InputError(`${name} is not a valid JSON Schema: ${error.message}`);
  }
}

function pointerToPath(pointer) {
  if (!pointer) return [];
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((token) => (/^(0|[1-9]\d*)$/.test(token) ? Number(token) : token));
}

/** Readable messages for Ajv errors: `{ path, message }` with a JSONPath and the relevant details. */
export function describeSchemaErrors(errors, basePath = []) {
  return errors.map((error) => {
    const path = [...basePath, ...pointerToPath(error.instancePath)];
    let message = error.message ?? 'is invalid';
    const params = error.params ?? {};
    if (error.keyword === 'enum' && params.allowedValues) message += `: ${params.allowedValues.map((value) => JSON.stringify(value)).join(', ')}`;
    if (error.keyword === 'additionalProperties' && params.additionalProperty !== undefined) message += `: ${JSON.stringify(params.additionalProperty)}`;
    if (error.keyword === 'const' && 'allowedValue' in params) message += `: ${JSON.stringify(params.allowedValue)}`;
    return { path, jsonPath: formatPath(path), message };
  });
}
