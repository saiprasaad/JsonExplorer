/** @jest-environment node */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { decodeBuffer, DEFAULT_MAX_SIZE_MB, detectEol, encodeLike, InputError, readInput, readLines, readStreamBytes, toReadable, writeFileAtomic } from './io';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'je-io-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

const write = (name, content) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
};

async function collect(iterator) {
  const items = [];
  for await (const item of iterator) items.push(item);
  return items;
}

describe('decodeBuffer', () => {
  it('decodes UTF-8, remembering a byte order mark', () => {
    expect(decodeBuffer(Buffer.from('{"a":"é"}'), 'x')).toEqual({ text: '{"a":"é"}', bom: null });
    expect(decodeBuffer(Buffer.from('﻿[1]'), 'x')).toEqual({ text: '[1]', bom: 'utf-8' });
  });

  it('decodes UTF-16 with a byte order mark', () => {
    expect(decodeBuffer(encodeLike('[1,"é"]', { bom: 'utf-16le', eol: '\n' }), 'x')).toEqual({ text: '[1,"é"]', bom: 'utf-16le' });
    expect(decodeBuffer(encodeLike('[1,"é"]', { bom: 'utf-16be', eol: '\n' }), 'x')).toEqual({ text: '[1,"é"]', bom: 'utf-16be' });
  });

  it('refuses binary data and invalid UTF-8', () => {
    expect(() => decodeBuffer(Buffer.from([0x7b, 0x00, 0x7d]), 'img.png')).toThrow('img.png is not a text file (it contains binary data).');
    expect(() => decodeBuffer(Buffer.from([0x22, 0xff, 0x22]), 'latin1.json')).toThrow('latin1.json is not valid UTF-8 text.');
  });
});

describe('streams', () => {
  it('turns strings and buffers into readable streams and passes streams through', async () => {
    expect((await readStreamBytes(toReadable('abc'), 10, 'stdin', 1)).toString()).toBe('abc');
    expect((await readStreamBytes(toReadable(Buffer.from('xyz')), 10, 'stdin', 1)).toString()).toBe('xyz');
    const stream = Readable.from(['a', 'b']);
    expect(toReadable(stream)).toBe(stream);
    expect((await readStreamBytes(stream, 10, 'stdin', 1)).toString()).toBe('ab');
  });

  it('stops reading past the size limit', async () => {
    await expect(readStreamBytes(Readable.from([Buffer.alloc(8), Buffer.alloc(8)]), 10, 'stdin', 1)).rejects.toThrow(
      'stdin is 16 B, over the 1 MB limit for loading a whole document. Raise it with --max-size <MB> if this machine has the memory. JSON Lines files are streamed by outline, validate and query at any size.'
    );
  });
});

describe('readInput', () => {
  it('reads a file with its details', async () => {
    const file = write('data.json', '﻿{\r\n"a": 1}\r\n');
    await expect(readInput('data.json', { cwd: dir })).resolves.toMatchObject({ name: 'data.json', path: file, text: '{\r\n"a": 1}\r\n', bytes: 15, bom: 'utf-8', eol: '\r\n' });
  });

  it('reads stdin for "-"', async () => {
    await expect(readInput('-', { cwd: dir, stdin: '[1]\n' })).resolves.toMatchObject({ name: 'stdin', path: null, text: '[1]\n', bytes: 4, bom: null, eol: '\n' });
  });

  it('explains missing files, directories and unreadable paths', async () => {
    await expect(readInput('missing.json', { cwd: dir })).rejects.toThrow('missing.json: no such file.');
    fs.mkdirSync(path.join(dir, 'folder'));
    await expect(readInput('folder', { cwd: dir })).rejects.toThrow('folder is a directory, not a file.');
    write('file.json', '1');
    await expect(readInput('file.json/inner.json', { cwd: dir })).rejects.toThrow(/^Cannot read file\.json\/inner\.json: /);
  });

  it('reads pipes and devices with the size limit, and stops at binary data at once', async () => {
    await expect(readInput('/dev/zero', { cwd: dir })).rejects.toThrow('/dev/zero is not a text file (it contains binary data).');
    const fifo = path.join(dir, 'pipe.json');
    require('node:child_process').execFileSync('mkfifo', [fifo]);
    const writer = fs.promises.writeFile(fifo, '[1, 2]');
    await expect(readInput('pipe.json', { cwd: dir })).resolves.toMatchObject({ text: '[1, 2]', mode: null });
    await writer;
    const big = fs.promises.writeFile(fifo, Buffer.alloc(2 * 1024 * 1024, 0x20)).catch(() => {});
    await expect(readInput('pipe.json', { cwd: dir, maxSizeMb: 1 })).rejects.toThrow('pipe.json is');
    await big;
  });

  it('refuses files over the size limit before reading them', async () => {
    write('big.json', Buffer.alloc(2 * 1024 * 1024, 0x20));
    await expect(readInput('big.json', { cwd: dir, maxSizeMb: 1 })).rejects.toThrow('big.json is 2.0 MB, over the 1 MB limit');
    await expect(readInput('-', { cwd: dir, stdin: Buffer.alloc(2 * 1024 * 1024, 0x20), maxSizeMb: 1 })).rejects.toThrow(InputError);
    expect(DEFAULT_MAX_SIZE_MB).toBe(512);
  });
});

describe('detectEol', () => {
  it('reports the first line ending', () => {
    expect(detectEol('a\r\nb\n')).toBe('\r\n');
    expect(detectEol('a\nb\r\n')).toBe('\n');
    expect(detectEol('\nb')).toBe('\n');
    expect(detectEol('no line breaks')).toBe('\n');
  });
});

describe('readLines', () => {
  it('streams the lines of a file, dropping a byte order mark and CRLF endings', async () => {
    write('a.jsonl', '﻿{"a":1}\r\n\r\n{"b":2}');
    await expect(collect(readLines('a.jsonl', { cwd: dir }))).resolves.toEqual([
      { line: '{"a":1}', number: 1 },
      { line: '', number: 2 },
      { line: '{"b":2}', number: 3 },
    ]);
  });

  it('streams stdin and one-byte or empty files', async () => {
    await expect(collect(readLines('-', { cwd: dir, stdin: '1\n2\n' }))).resolves.toEqual([
      { line: '1', number: 1 },
      { line: '2', number: 2 },
    ]);
    write('one.jsonl', '7');
    await expect(collect(readLines('one.jsonl', { cwd: dir }))).resolves.toEqual([{ line: '7', number: 1 }]);
    write('empty.jsonl', '');
    await expect(collect(readLines('empty.jsonl', { cwd: dir }))).resolves.toEqual([]);
  });

  it('decodes UTF-16 little-endian and refuses big-endian', async () => {
    write('le.jsonl', encodeLike('"é"\n[2]\n', { bom: 'utf-16le', eol: '\n' }));
    await expect(collect(readLines('le.jsonl', { cwd: dir }))).resolves.toEqual([
      { line: '"é"', number: 1 },
      { line: '[2]', number: 2 },
    ]);
    write('be.jsonl', encodeLike('1\n', { bom: 'utf-16be', eol: '\n' }));
    await expect(collect(readLines('be.jsonl', { cwd: dir }))).rejects.toThrow('be.jsonl is UTF-16 (big-endian); convert it to UTF-8 to stream it.');
  });

  it('refuses binary data', async () => {
    write('bin.jsonl', Buffer.from([0x31, 0x0a, 0x00, 0x0a]));
    await expect(collect(readLines('bin.jsonl', { cwd: dir }))).rejects.toThrow('bin.jsonl is not a text file (it contains binary data).');
    await expect(collect(readLines('-', { cwd: dir, stdin: Buffer.from([0x00]) }))).rejects.toThrow('stdin is not a text file');
  });

  it('keeps a byte order mark that is not at the very start (it makes that record invalid)', async () => {
    write('mid.jsonl', '\ufeff1\n\ufeff2\n');
    await expect(collect(readLines('mid.jsonl', { cwd: dir }))).resolves.toEqual([
      { line: '1', number: 1 },
      { line: '\ufeff2', number: 2 },
    ]);
    // Streams of strings (an encoding set on stdin) work too.
    await expect(collect(readLines('-', { cwd: dir, stdin: Readable.from(['a\nb', '\n']) }))).resolves.toEqual([
      { line: 'a', number: 1 },
      { line: 'b', number: 2 },
    ]);
  });

  it('ends lines at line feeds only, as the whole-file reader does', async () => {
    write('cr.jsonl', '{"a":1,\r"b":2}\n{"a":3}');
    await expect(collect(readLines('cr.jsonl', { cwd: dir }))).resolves.toEqual([
      { line: '{"a":1,\r"b":2}', number: 1 },
      { line: '{"a":3}', number: 2 },
    ]);
  });

  it('refuses text that is not valid UTF-8, and lines too long to be records', async () => {
    write('latin1.jsonl', Buffer.concat([Buffer.from('"ok"\n"caf'), Buffer.from([0xe9]), Buffer.from('"\n')]));
    await expect(collect(readLines('latin1.jsonl', { cwd: dir }))).rejects.toThrow('latin1.jsonl is not valid UTF-8 text (line 2).');
    write('cut.jsonl', Buffer.concat([Buffer.from('"ok"\n"'), Buffer.from([0xc3])]));
    await expect(collect(readLines('cut.jsonl', { cwd: dir }))).rejects.toThrow('cut.jsonl is not valid UTF-8 text (line 2).');
    write('long.jsonl', `[1]\n${'x'.repeat(100)}`);
    await expect(collect(readLines('long.jsonl', { cwd: dir, maxLineChars: 50 }))).rejects.toThrow('long.jsonl: line 2 is longer than 50 B; this is not JSON Lines.');
    // A multi-byte character split across reads is decoded whole.
    const stdin = Readable.from([Buffer.from([0x22, 0xc3]), Buffer.from([0xa9, 0x22, 0x0a])]);
    await expect(collect(readLines('-', { cwd: dir, stdin }))).resolves.toEqual([{ line: '"é"', number: 1 }]);
  });

  it('explains missing files, directories and unreadable paths', async () => {
    await expect(collect(readLines('nope.jsonl', { cwd: dir }))).rejects.toThrow('nope.jsonl: no such file.');
    fs.mkdirSync(path.join(dir, 'd'));
    await expect(collect(readLines('d', { cwd: dir }))).rejects.toThrow('d is a directory, not a file.');
    write('f.jsonl', '1');
    await expect(collect(readLines('f.jsonl/x', { cwd: dir }))).rejects.toThrow(/^Cannot read f\.jsonl\/x: /);
  });
});

describe('encodeLike', () => {
  it('restores line endings and byte order marks', () => {
    expect(encodeLike('a\nb\r\nc', { bom: null, eol: '\r\n' }).toString()).toBe('a\r\nb\r\nc');
    expect(encodeLike('a\nb', { bom: null, eol: '\n' }).toString()).toBe('a\nb');
    expect([...encodeLike('x', { bom: 'utf-8', eol: '\n' })]).toEqual([0xef, 0xbb, 0xbf, 0x78]);
    expect([...encodeLike('x', { bom: 'utf-16le', eol: '\n' })]).toEqual([0xff, 0xfe, 0x78, 0x00]);
    expect([...encodeLike('x', { bom: 'utf-16be', eol: '\n' })]).toEqual([0xfe, 0xff, 0x00, 0x78]);
  });
});

describe('writeFileAtomic', () => {
  const mode = (file) => fs.statSync(file).mode & 0o777;

  it('creates files with the requested mode and leaves no temporary files', () => {
    const target = path.join(dir, 'new.json');
    expect(writeFileAtomic(target, '{}', { mode: 0o600 })).toBe(target);
    expect(fs.readFileSync(target, 'utf8')).toBe('{}');
    expect(mode(target)).toBe(0o600);
    expect(fs.readdirSync(dir)).toEqual(['new.json']);
    writeFileAtomic(path.join(dir, 'plain.json'), '1');
    expect(fs.readFileSync(path.join(dir, 'plain.json'), 'utf8')).toBe('1');
  });

  it('keeps the permissions of a file it replaces, narrowed (never widened) to the requested mode', () => {
    const target = write('existing.json', 'old');
    fs.chmodSync(target, 0o640);
    writeFileAtomic(target, 'new');
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
    expect(mode(target)).toBe(0o640);
    writeFileAtomic(target, 'newer', { mode: 0o600 });
    expect(mode(target)).toBe(0o600);
    writeFileAtomic(target, 'still private', { mode: 0o644 });
    expect(mode(target)).toBe(0o600);
    writeFileAtomic(target, 'forced', { mode: 0o644, forceMode: true });
    expect(mode(target)).toBe(0o644);
  });

  it('refuses to write over an input', () => {
    const input = write('input.json', '{}');
    fs.symlinkSync(input, path.join(dir, 'alias.json'));
    expect(() => writeFileAtomic(path.join(dir, 'alias.json'), 'x', { inputs: [null, input] })).toThrow(`Refusing to write over the input ${path.join(dir, 'alias.json')}; choose another output file.`);
    expect(() => writeFileAtomic(path.join(dir, 'other.json'), 'x', { inputs: [input, path.join(dir, 'missing.json')] })).not.toThrow();
    expect(fs.readFileSync(input, 'utf8')).toBe('{}');
  });

  it('writes straight into special files instead of replacing them', () => {
    expect(writeFileAtomic('/dev/zero', 'discarded')).toBe('/dev/zero');
    expect(fs.statSync('/dev/zero').isCharacterDevice()).toBe(true);
    const denied = jest.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });
    expect(() => writeFileAtomic('/dev/zero', 'x')).toThrow('Cannot write /dev/zero: permission denied.');
    denied.mockRestore();
  });

  it('never follows anything planted at its temporary file name', () => {
    const target = path.join(dir, 'page.html');
    const victim = write('victim.txt', 'keep');
    jest.spyOn(crypto, 'randomBytes').mockReturnValueOnce(Buffer.from('0123456789abcdef', 'hex'));
    fs.symlinkSync(victim, path.join(dir, '.page.html.0123456789abcdef.tmp'));
    expect(() => writeFileAtomic(target, 'data')).toThrow(/^Cannot write .*page\.html: EEXIST/);
    expect(fs.readFileSync(victim, 'utf8')).toBe('keep');
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.lstatSync(path.join(dir, '.page.html.0123456789abcdef.tmp')).isSymbolicLink()).toBe(true);
  });

  it('writes through symbolic links', () => {
    const real = write('real.json', 'old');
    const link = path.join(dir, 'link.json');
    fs.symlinkSync(real, link);
    expect(writeFileAtomic(link, 'new')).toBe(fs.realpathSync(real));
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(real, 'utf8')).toBe('new');
  });

  it('explains failures and cleans up', () => {
    const missing = path.join(dir, 'missing', 'x.json');
    expect(() => writeFileAtomic(missing, '1')).toThrow(`Cannot write ${missing}: the folder ${path.join(dir, 'missing')} does not exist.`);
    fs.mkdirSync(path.join(dir, 'occupied'));
    expect(() => writeFileAtomic(path.join(dir, 'occupied'), '1')).toThrow(`Cannot write ${path.join(dir, 'occupied')}: it is a folder.`);
    expect(fs.readdirSync(dir)).toEqual(['occupied']);
  });

  it('explains permission problems and other failures', () => {
    const fail = (code, message = 'failed') => {
      jest.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
        throw Object.assign(new Error(message), { code });
      });
    };
    const target = path.join(dir, 'x.json');
    fail('EACCES');
    expect(() => writeFileAtomic(target, '1')).toThrow(`Cannot write ${target}: permission denied.`);
    fail('EPERM');
    expect(() => writeFileAtomic(target, '1')).toThrow('permission denied.');
    fail('ENOSPC', 'ENOSPC: no space left on device');
    expect(() => writeFileAtomic(target, '1')).toThrow(`Cannot write ${target}: ENOSPC: no space left on device`);
    fail('ENOENT', 'vanished');
    expect(() => writeFileAtomic(target, '1')).toThrow(`Cannot write ${target}: vanished`);
    jest.restoreAllMocks();
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
