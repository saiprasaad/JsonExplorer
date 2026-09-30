/** @jest-environment node */
import { outline } from './commands/outline';
import { COMMANDS } from './main';
import { makeWorkspace } from './testing/workspace';
import { VERSION } from './version';

let ws;
beforeEach(() => {
  ws = makeWorkspace({ 'data.json': '{"a": 1}' });
});
afterEach(() => {
  ws.cleanup();
  jest.restoreAllMocks();
});

describe('help and version', () => {
  it.each([[[]], [['--help']], [['-h']], [['help']], [['help', 'nonsense']]])('prints the general help for %j', async (argv) => {
    const { code, stdout, stderr } = await ws.run(argv);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain(`JSON Explorer ${VERSION}: explore, query, compare, validate, repair, format and convert JSON.`);
    expect(stdout).toContain('Everything runs locally: nothing is uploaded, and no command uses the network.');
    COMMANDS.filter((command) => !command.hidden).forEach((command) => expect(stdout).toContain(`  ${command.name}`));
    expect(stdout).not.toContain('hook');
  });

  it.each([['--version'], ['-v']])('prints the version for %s', async (flag) => {
    expect(await ws.run([flag])).toEqual({ code: 0, stdout: `${VERSION}\n`, stderr: '' });
  });

  it('prints a command help with its options and examples', async () => {
    const { code, stdout } = await ws.run(['help', 'query']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: json-explorer query <file> <path>...');
    expect(stdout).toMatch(/\n {2}-o, --out <value> +Write the matched value/);
    expect(stdout).toMatch(/\n {2}--count +Print only the number of matches\./);
    expect(stdout).toContain("\nExamples:\n  json-explorer query data.json '$.users[0]'");
  });

  it('accepts aliases and --help after a command', async () => {
    expect((await ws.run(['help', 'get'])).stdout).toContain('Usage: json-explorer query');
    expect((await ws.run(['fmt', '--help'])).stdout).toContain('Usage: json-explorer format');
    expect((await ws.run(['sort', '-h'])).stdout).toContain('Usage: json-explorer sort-keys');
    expect((await ws.run(['view', '--help'])).stdout).toContain('Usage: json-explorer explore');
  });

  it('prints the help of a command without options or examples', async () => {
    const { stdout } = await ws.run(['help', 'hook']);
    expect(stdout).not.toContain('Options:');
    expect(stdout).not.toContain('Examples:');
  });
});

describe('errors', () => {
  it('reports unknown commands', async () => {
    const { code, stdout, stderr } = await ws.run(['frobnicate']);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toBe(
      'json-explorer: Unknown command "frobnicate". Commands: explore, outline, query, diff, validate, repair, format, minify, sort-keys, convert.\nRun "json-explorer --help" for usage.\n'
    );
  });

  it('reports usage mistakes with a pointer to the command help', async () => {
    const { code, stderr } = await ws.run(['outline', 'data.json', '--nope']);
    expect(code).toBe(2);
    expect(stderr).toBe('json-explorer: Unknown option --nope. Did you mean --top?\nRun "json-explorer outline --help" for usage.\n');
  });

  it('reports input, document and path errors without a stack trace', async () => {
    expect(await ws.run(['outline', 'missing.json'])).toEqual({ code: 2, stdout: '', stderr: 'json-explorer: missing.json: no such file.\n' });
    ws.write('bad.json', '{"a": }');
    expect((await ws.run(['outline', 'bad.json'])).stderr).toMatch(/^json-explorer: bad\.json is not valid JSON: /);
    const { code, stderr } = await ws.run(['query', 'data.json', '$.[']);
    expect(code).toBe(2);
    expect(stderr).toMatch(/^json-explorer: Invalid JSONPath: /);
  });

  it('reports documents nested too deeply, and data too large for an operation', async () => {
    jest.spyOn(outline, 'run').mockRejectedValue(new RangeError('Maximum call stack size exceeded'));
    expect(await ws.run(['outline', 'data.json'])).toEqual({ code: 2, stdout: '', stderr: 'json-explorer: the document is nested too deeply for this operation.\n' });
    outline.run.mockRejectedValue(new RangeError('Invalid string length'));
    expect(await ws.run(['outline', 'data.json'])).toEqual({ code: 2, stdout: '', stderr: 'json-explorer: the data is too large for this operation (Invalid string length).\n' });
  });

  it('reports unexpected errors with details', async () => {
    const error = new TypeError('boom');
    jest.spyOn(outline, 'run').mockRejectedValue(error);
    const result = await ws.run(['outline', 'data.json']);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe(`json-explorer: unexpected error: ${error.stack}\n`);
    outline.run.mockRejectedValue('plain failure');
    expect((await ws.run(['outline', 'data.json'])).stderr).toBe('json-explorer: unexpected error: plain failure\n');
  });
});
