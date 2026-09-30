/**
 * @jest-environment node
 */
// Runs the official JSONPath Compliance Test Suite (https://github.com/jsonpath-standard/jsonpath-compliance-test-suite,
// BSD-2-Clause, see __fixtures__/jsonpath-cts.LICENSE) against the RFC 9535 implementation.
import cts from './__fixtures__/jsonpath-cts.json';
import { compileJsonPath, JsonPathError, normalizedPath } from './jsonpath';

const run = (test) => {
  const nodes = compileJsonPath(test.selector).evaluate(test.document);
  return { values: nodes.map((node) => node.value), paths: nodes.map((node) => normalizedPath(node.path)) };
};

const cases = (predicate) => cts.tests.filter(predicate).map((test) => [test.name, test]);

describe('JSONPath compliance test suite', () => {
  test.each(cases((test) => test.invalid_selector))('%s', (_, test) => {
    expect(() => compileJsonPath(test.selector)).toThrow(JsonPathError);
  });

  test.each(cases((test) => !test.invalid_selector && test.result))('%s', (_, test) => {
    expect(run(test)).toEqual({ values: test.result, paths: test.result_paths });
  });

  // Object member order is unspecified, so the suite lists every acceptable result for these.
  test.each(cases((test) => !test.invalid_selector && !test.result))('%s', (_, test) => {
    const accepted = test.results.map((values, index) => ({ values, paths: test.results_paths[index] }));
    expect(accepted).toContainEqual(run(test));
  });
});
