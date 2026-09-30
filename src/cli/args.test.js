/** @jest-environment node */
import { parseArgs, UsageError } from './args';

const OPTIONS = {
  out: { type: 'string', alias: 'o' },
  limit: { type: 'number' },
  ignore: { type: 'string', multiple: true },
  check: { type: 'boolean', alias: 'c' },
  'final-newline': { type: 'boolean' },
};

describe('parseArgs', () => {
  it('separates options from positionals', () => {
    expect(parseArgs(['a.json', '--out', 'x.html', 'b.json'], OPTIONS)).toEqual({ values: { out: 'x.html' }, positionals: ['a.json', 'b.json'] });
  });

  it('accepts --name=value, aliases and "-" as a positional', () => {
    expect(parseArgs(['--out=x', '-o', 'y', '-'], OPTIONS)).toEqual({ values: { out: 'y' }, positionals: ['-'] });
    expect(parseArgs(['--out='], OPTIONS).values.out).toBe('');
  });

  it('parses numbers and rejects anything else', () => {
    expect(parseArgs(['--limit', '5'], OPTIONS).values.limit).toBe(5);
    expect(parseArgs(['--limit=0'], OPTIONS).values.limit).toBe(0);
    expect(() => parseArgs(['--limit', 'many'], OPTIONS)).toThrow('--limit expects a number, got "many".');
    expect(() => parseArgs(['--limit', ' '], OPTIONS)).toThrow(UsageError);
    expect(() => parseArgs(['--limit', 'Infinity'], OPTIONS)).toThrow(UsageError);
  });

  it('collects repeatable options', () => {
    expect(parseArgs(['--ignore', '$.a', '--ignore=$.b'], OPTIONS).values.ignore).toEqual(['$.a', '$.b']);
  });

  it('handles booleans, including --no-<flag>', () => {
    expect(parseArgs(['--check', '-c'], OPTIONS).values.check).toBe(true);
    expect(parseArgs(['--no-final-newline'], OPTIONS).values['final-newline']).toBe(false);
    expect(() => parseArgs(['--check=yes'], OPTIONS)).toThrow('--check does not take a value.');
    expect(() => parseArgs(['--no-out'], OPTIONS)).toThrow('Unknown option --no-out.');
    expect(() => parseArgs(['--no-check=1'], OPTIONS)).toThrow('Unknown option --no-check.');
  });

  it('stops reading options after --', () => {
    expect(parseArgs(['--', '--out', '-o'], OPTIONS)).toEqual({ values: {}, positionals: ['--out', '-o'] });
  });

  it('treats negative numbers as positionals', () => {
    expect(parseArgs(['-5', '-1.5'], OPTIONS).positionals).toEqual(['-5', '-1.5']);
  });

  it('reports missing values and unknown options, suggesting close matches', () => {
    expect(() => parseArgs(['--out'], OPTIONS)).toThrow('--out needs a value.');
    expect(() => parseArgs(['--limt', '3'], OPTIONS)).toThrow('Unknown option --limt. Did you mean --limit?');
    expect(() => parseArgs(['--completely-different'], OPTIONS)).toThrow(/^Unknown option --completely-different\.$/);
    expect(() => parseArgs(['--anything'], {})).toThrow(/^Unknown option --anything\.$/);
    expect(() => parseArgs(['-z'], OPTIONS)).toThrow('Unknown option -z.');
  });

  it('throws UsageError instances', () => {
    let error;
    try {
      parseArgs(['--nope'], OPTIONS);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UsageError);
    expect(error.name).toBe('UsageError');
  });
});
