/** @jest-environment node */
import { compileSchema, describeSchemaErrors } from './schema';
import { InputError } from './io';

describe('compileSchema', () => {
  it('rejects values that cannot be schemas', () => {
    expect(() => compileSchema([], 's.json')).toThrow('s.json is not a JSON Schema (it must be an object or a boolean).');
    expect(() => compileSchema(3, 's.json')).toThrow(InputError);
    expect(() => compileSchema(null, 's.json')).toThrow(InputError);
  });

  it('accepts boolean schemas', () => {
    expect(compileSchema(true, 's')(123)).toBe(true);
    expect(compileSchema(false, 's')(123)).toBe(false);
  });

  it('refuses draft-03 and draft-04', () => {
    expect(() => compileSchema({ $schema: 'http://json-schema.org/draft-04/schema#' }, 's.json')).toThrow('s.json uses JSON Schema draft-04, which is not supported. Use draft-06 or later.');
    expect(() => compileSchema({ $schema: 'http://json-schema.org/draft-03/schema#' }, 's.json')).toThrow('draft-03');
  });

  it.each([
    ['https://json-schema.org/draft/2020-12/schema', { prefixItems: [{ type: 'number' }] }, [1], ['x']],
    ['https://json-schema.org/draft/2019-09/schema', { type: 'object', unevaluatedProperties: false, properties: { a: {} } }, { a: 1 }, { a: 1, b: 2 }],
    ['http://json-schema.org/draft-07/schema#', { if: { type: 'number' }, then: { minimum: 5 } }, 7, 3],
    ['http://json-schema.org/draft-06/schema#', { type: 'integer' }, 1, 1.5],
    [undefined, { type: 'string', format: 'email' }, 'a@example.com', 'not an email'],
  ])('validates with the dialect of %s', (uri, schema, good, bad) => {
    const validate = compileSchema({ ...(uri ? { $schema: uri } : {}), ...schema }, 's');
    expect(validate(good)).toBe(true);
    expect(validate(bad)).toBe(false);
  });

  it('reports unusable schemas', () => {
    expect(() => compileSchema({ type: 12 }, 's.json')).toThrow(/^s\.json is not a valid JSON Schema: /);
    expect(() => compileSchema({ $ref: '#/definitions/missing' }, 's.json')).toThrow(InputError);
  });
});

describe('describeSchemaErrors', () => {
  const errorsFor = (schema, data) => {
    const validate = compileSchema(schema, 's');
    validate(data);
    return describeSchemaErrors(validate.errors);
  };

  it('gives each error a path and a readable message', () => {
    expect(errorsFor({ type: 'object', required: ['id'] }, {})).toEqual([{ path: [], jsonPath: '$', message: "must have required property 'id'" }]);
    expect(errorsFor({ items: { enum: ['a', 1] } }, ['a', 'b'])).toEqual([{ path: [1], jsonPath: '$[1]', message: 'must be equal to one of the allowed values: "a", 1' }]);
    expect(errorsFor({ additionalProperties: false }, { extra: 1 })[0].message).toBe('must NOT have additional properties: "extra"');
    expect(errorsFor({ properties: { v: { const: 3 } } }, { v: 4 })[0]).toEqual({ path: ['v'], jsonPath: '$.v', message: 'must be equal to constant: 3' });
  });

  it('decodes JSON Pointer paths and prefixes a base path', () => {
    const [error] = describeSchemaErrors([{ instancePath: '/a~1b/c~0d/0/01', message: 'is wrong' }], ['records', 2]);
    expect(error.path).toEqual(['records', 2, 'a/b', 'c~d', 0, '01']);
    expect(error.jsonPath).toBe('$.records[2]["a/b"]["c~d"][0]["01"]');
  });

  it('copes with errors that lack a message or parameters', () => {
    expect(describeSchemaErrors([{ instancePath: '', keyword: 'enum' }])).toEqual([{ path: [], jsonPath: '$', message: 'is invalid' }]);
    expect(describeSchemaErrors([{ instancePath: '', keyword: 'additionalProperties', message: 'm', params: {} }])[0].message).toBe('m');
    expect(describeSchemaErrors([{ instancePath: '', keyword: 'const', message: 'm', params: {} }])[0].message).toBe('m');
  });
});
