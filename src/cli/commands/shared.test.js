/** @jest-environment node */
import path from 'node:path';
import { RawNumber } from '../../utils/json';
import { derivedMode, describeInput, dialectFor, displayPath, forTerminal, lastKey, parseIndent, plural, precisionNote, preview, secretsNote, skippedNote } from './shared';

describe('dialectFor', () => {
  it('follows flags, then the file name', () => {
    expect(dialectFor('tsconfig.json', {})).toBe('jsonc');
    expect(dialectFor('tsconfig.json', { strict: true })).toBe('json');
    expect(dialectFor('data.txt', { jsonl: true })).toBe('jsonl');
    expect(dialectFor('data.txt', { jsonc: true })).toBe('jsonc');
    expect(dialectFor('-', {})).toBe('json');
    expect(() => dialectFor('x.json', { jsonl: true, jsonc: true })).toThrow('Use only one of --jsonl, --jsonc and --strict.');
  });
});

describe('parseIndent', () => {
  it('accepts 0–10 spaces or a tab', () => {
    expect(parseIndent(undefined)).toBe(2);
    expect(parseIndent('4')).toBe(4);
    expect(parseIndent('0')).toBe(0);
    expect(parseIndent('tab')).toBe('\t');
    expect(parseIndent('\t')).toBe('\t');
    expect(() => parseIndent('11')).toThrow('--indent expects 0–10 or "tab", got "11".');
  });
});

describe('formatting helpers', () => {
  it('pluralizes with thousands separators', () => {
    expect(plural(1, 'file')).toBe('1 file');
    expect(plural(1234, 'file')).toBe('1,234 files');
    expect(plural(2, 'match', 'matches')).toBe('2 matches');
  });

  it('finds the member name at the end of a path', () => {
    expect(lastKey(['a', 0, 'token'])).toBe('token');
    expect(lastKey(['a', 0])).toBeUndefined();
    expect(lastKey(null)).toBeUndefined();
  });

  it('previews values compactly, masking secrets', () => {
    const counter = { count: 0 };
    expect(preview({ a: 1, password: 'x' }, { counter })).toBe('{"a":1,"password":"[REDACTED]"}');
    expect(preview('abc', { counter, key: 'token' })).toBe('"[REDACTED]"');
    expect(preview('abc', { counter, key: 'token', showSecrets: true })).toBe('"abc"');
    expect(preview(new RawNumber('1.50'), { counter })).toBe('1.50');
    expect(preview('x'.repeat(200), { counter, max: 10 })).toHaveLength(10);
    expect(counter.count).toBe(2);
  });

  it('explains masked values', () => {
    expect(secretsNote({ count: 0 })).toBe('');
    expect(secretsNote({ count: 1 })).toBe('1 value hidden because it looks like a secret; add --show-secrets to reveal it.');
    expect(secretsNote({ count: 3 })).toBe('3 values hidden because they look like secrets; add --show-secrets to reveal them.');
  });

  it('summarizes skipped lines and inputs', () => {
    expect(skippedNote([{ line: 3, column: 1, message: 'bad' }], 5)).toBe('Note: 5 invalid lines skipped (first at line 3, column 1: bad).');
    expect(describeInput({ name: 'a.json', bytes: 2048 }, 'jsonc')).toBe('a.json · JSON with comments · 2.0 KB');
  });

  it('shows paths relative to the working directory when inside it', () => {
    const cwd = path.join(path.sep, 'work', 'project');
    expect(displayPath(path.join(cwd, 'out', 'a.html'), cwd)).toBe(path.join('out', 'a.html'));
    expect(displayPath(path.join(path.sep, 'work', 'other.html'), cwd)).toBe(path.join(path.sep, 'work', 'other.html'));
    expect(displayPath(cwd, cwd)).toBe(cwd);
  });
});

describe('precisionNote', () => {
  it('warns once per run, only when a parse had to round numbers', () => {
    const messages = [];
    const ctx = { err: (text) => messages.push(text) };
    precisionNote({ value: 1 }, ctx);
    expect(messages).toEqual([]);
    precisionNote({ value: 1, rounded: true }, ctx);
    precisionNote({ value: 2, rounded: true }, ctx);
    expect(messages).toEqual([
      'Note: this document is nested too deeply to keep numbers such as 12345678901234567890 or 1.50 exactly as written here; results may show them rounded. Node.js 22 or later keeps them exact.',
    ]);
  });
});

describe('derivedMode', () => {
  it('never gives others more access than the input has, and always lets the owner write', () => {
    expect(derivedMode({ mode: 0o600 })).toBe(0o600);
    expect(derivedMode({ mode: 0o640 })).toBe(0o640);
    expect(derivedMode({ mode: 0o644 })).toBe(0o644);
    expect(derivedMode({ mode: 0o400 })).toBe(0o600);
    expect(derivedMode({ mode: 0o777 })).toBe(0o666);
    // Data from stdin could be anything: what is derived from it is private.
    expect(derivedMode({ mode: null })).toBe(0o600);
  });
});

describe('forTerminal', () => {
  it('shows control characters as escapes on a terminal, and leaves piped output alone', () => {
    const text = 'a\u001b]0;title\u0007b\tc\nd\u009b';
    expect(forTerminal(text, { stdoutIsTTY: true })).toBe('a\\u001b]0;title\\u0007b\tc\nd\\u009b');
    expect(forTerminal(text, { stdoutIsTTY: false })).toBe(text);
  });
});
