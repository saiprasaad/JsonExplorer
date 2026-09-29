import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { formatBytes } from '../utils/json';

export const DEFAULT_MAX_SIZE_MB = 512;
// Longer lines are not JSON Lines records (or not text at all, like /dev/zero).
export const MAX_LINE_CHARS = 256 * 1024 * 1024;

/** A problem with an input or output file: reported as a clean message, exit code 2. */
export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];

/**
 * Decodes file bytes as text: strips a UTF-8 byte order mark (remembering it), decodes UTF-16 with
 * a byte order mark, and refuses binary data or invalid UTF-8 instead of producing garbage.
 */
export function decodeBuffer(buffer, name) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(buffer.subarray(2)), bom: 'utf-16le' };
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(buffer.subarray(2)), bom: 'utf-16be' };
  const hasBom = UTF8_BOM.every((byte, index) => buffer[index] === byte);
  const body = hasBom ? buffer.subarray(3) : buffer;
  if (body.subarray(0, 8192).includes(0)) throw new InputError(`${name} is not a text file (it contains binary data).`);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), bom: hasBom ? 'utf-8' : null };
  } catch {
    throw new InputError(`${name} is not valid UTF-8 text.`);
  }
}

function sizeError(name, bytes, maxSizeMb) {
  return new InputError(
    `${name} is ${formatBytes(bytes)}, over the ${maxSizeMb} MB limit for loading a whole document. ` +
      'Raise it with --max-size <MB> if this machine has the memory. JSON Lines files are streamed by outline, validate and query at any size.'
  );
}

export async function readStreamBytes(stream, maxBytes, name, maxSizeMb, refuseBinary = false) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (refuseBinary && total < 8192 && buffer.subarray(0, 8192 - total).includes(0)) {
      stream.destroy?.();
      throw new InputError(`${name} is not a text file (it contains binary data).`);
    }
    total += buffer.length;
    if (total > maxBytes) {
      stream.destroy?.();
      throw sizeError(name, total, maxSizeMb);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** A Node Readable for the command's stdin (tests pass a string or Buffer instead of a stream). */
export function toReadable(stdin) {
  return typeof stdin === 'string' || Buffer.isBuffer(stdin) ? Readable.from([Buffer.from(stdin)]) : stdin;
}

/**
 * Reads a whole input file (or stdin for "-") as text.
 * Returns `{ name, path, mode, text, buffer, bytes, bom, eol }`; `path` and `mode` are null for stdin.
 */
export async function readInput(file, { cwd, stdin, maxSizeMb = DEFAULT_MAX_SIZE_MB }) {
  const maxBytes = maxSizeMb * 1024 * 1024;
  let buffer;
  let absolute = null;
  let mode = null;
  const name = file === '-' ? 'stdin' : file;
  if (file === '-') {
    buffer = await readStreamBytes(toReadable(stdin), maxBytes, name, maxSizeMb);
  } else {
    absolute = path.resolve(cwd, file);
    let stat;
    try {
      stat = fs.statSync(absolute);
    } catch (error) {
      throw new InputError(error.code === 'ENOENT' ? `${file}: no such file.` : `Cannot read ${file}: ${error.message}`);
    }
    if (stat.isDirectory()) throw new InputError(`${file} is a directory, not a file.`);
    if (stat.isFile()) {
      if (stat.size > maxBytes) throw sizeError(name, stat.size, maxSizeMb);
      mode = stat.mode & 0o777;
      buffer = fs.readFileSync(absolute);
    } else {
      // A pipe or device (<(command), /dev/stdin): its size is unknown until it ends, so read it
      // with the size limit, and stop at once if it starts with binary data (/dev/zero).
      buffer = await readStreamBytes(fs.createReadStream(absolute), maxBytes, name, maxSizeMb, true);
    }
  }
  const { text, bom } = decodeBuffer(buffer, name);
  return { name, path: absolute, mode, text, buffer, bytes: buffer.length, bom, eol: detectEol(text) };
}

/** The line ending a file uses ("\r\n" if its first line break is CRLF, else "\n"). */
export function detectEol(text) {
  const index = text.indexOf('\n');
  return index > 0 && text[index - 1] === '\r' ? '\r\n' : '\n';
}

/**
 * Streams the lines of a file (or stdin) as `{ line, number }`, for JSON Lines inputs of any size.
 * Lines end at "\n" only (a lone "\r" is whitespace inside a record, as in JSON), a trailing "\r"
 * is dropped, and the text must be valid UTF-8 (or UTF-16 with a byte order mark), as when a whole
 * file is read. A UTF-8 byte order mark on the first line is dropped.
 */
export async function* readLines(file, { cwd, stdin, maxLineChars = MAX_LINE_CHARS }) {
  const name = file === '-' ? 'stdin' : file;
  let input;
  if (file === '-') {
    input = toReadable(stdin);
  } else {
    const absolute = path.resolve(cwd, file);
    try {
      if (fs.statSync(absolute).isDirectory()) throw new InputError(`${file} is a directory, not a file.`);
    } catch (error) {
      if (error instanceof InputError) throw error;
      throw new InputError(error.code === 'ENOENT' ? `${file}: no such file.` : `Cannot read ${file}: ${error.message}`);
    }
    input = fs.createReadStream(absolute);
  }
  // ignoreBOM: a decoder would otherwise drop a byte order mark at the start of every line it decodes.
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let utf16 = null; // A UTF-16 decoder when the input starts with its byte order mark.
  let pending = []; // UTF-8: the bytes of the line read so far; UTF-16: its text.
  let pendingLength = 0;
  let number = 0;
  const finish = (text) => {
    number += 1;
    const line = text.endsWith('\r') ? text.slice(0, -1) : text;
    if (line.includes('\u0000')) throw new InputError(`${name} is not a text file (it contains binary data).`);
    return { line: number === 1 && line.charCodeAt(0) === 0xfeff ? line.slice(1) : line, number };
  };
  const decode = (bytes) => {
    try {
      return utf8.decode(bytes);
    } catch {
      throw new InputError(`${name} is not valid UTF-8 text (line ${number + 1}).`);
    }
  };
  const grow = (length) => {
    pendingLength += length;
    if (pendingLength > maxLineChars) throw new InputError(`${name}: line ${number + 1} is longer than ${formatBytes(maxLineChars)}; this is not JSON Lines.`);
  };
  try {
    let first = true;
    for await (const chunk of input) {
      let bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (first) {
        first = false;
        if (bytes[0] === 0xfe && bytes[1] === 0xff) throw new InputError(`${name} is UTF-16 (big-endian); convert it to UTF-8 to stream it.`);
        if (bytes[0] === 0xff && bytes[1] === 0xfe) {
          utf16 = new TextDecoder('utf-16le', { ignoreBOM: true });
          bytes = bytes.subarray(2);
        }
      }
      if (utf16) {
        // Line feeds can only be found after decoding: a 0x0A byte may be half of a UTF-16 unit.
        const text = utf16.decode(bytes, { stream: true });
        let start = 0;
        for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', start)) {
          yield finish(pending.join('') + text.slice(start, end));
          pending = [];
          pendingLength = 0;
          start = end + 1;
        }
        pending.push(text.slice(start));
        grow(text.length - start);
      } else {
        // In UTF-8 a 0x0A byte is always a line feed, so lines are split first and decoded whole.
        let start = 0;
        for (let end = bytes.indexOf(0x0a); end !== -1; end = bytes.indexOf(0x0a, start)) {
          pending.push(bytes.subarray(start, end));
          yield finish(decode(Buffer.concat(pending)));
          pending = [];
          pendingLength = 0;
          start = end + 1;
        }
        pending.push(bytes.subarray(start));
        grow(bytes.length - start);
      }
    }
    const rest = utf16 ? pending.join('') + utf16.decode() : decode(Buffer.concat(pending));
    if (rest !== '') yield finish(rest);
  } finally {
    input.destroy?.();
  }
}

/** Re-applies a file's byte order mark and line endings to text produced for it. */
export function encodeLike(text, { bom, eol }) {
  const body = eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text;
  if (bom === 'utf-16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, 'utf16le')]);
  if (bom === 'utf-16be') {
    const le = Buffer.from(body, 'utf16le');
    for (let index = 0; index + 1 < le.length; index += 2) [le[index], le[index + 1]] = [le[index + 1], le[index]];
    return Buffer.concat([Buffer.from([0xfe, 0xff]), le]);
  }
  return bom === 'utf-8' ? Buffer.concat([Buffer.from(UTF8_BOM), Buffer.from(body)]) : Buffer.from(body);
}

/**
 * Writes a file atomically (a new temporary file, then a rename), following symlinks, so a crash
 * or full disk never leaves a half-written document behind. Permissions: an existing file keeps
 * its own, narrowed to `mode` when given (never widened); a new file gets `mode` (default 0666
 * minus the umask); with `forceMode`, the file gets exactly `mode`. A destination that is not a
 * regular file (/dev/null, a pipe) is written directly. `inputs` are the paths being read: writing
 * over one of them is refused (use the command's in-place option for that).
 */
export function writeFileAtomic(target, content, { mode, forceMode = false, inputs = [] } = {}) {
  let destination = target;
  let existing = null;
  try {
    destination = fs.realpathSync(target);
    existing = fs.statSync(destination);
  } catch {
    // New file.
  }
  const same = inputs.filter(Boolean).find((input) => {
    try {
      return fs.realpathSync(input) === destination;
    } catch {
      return false;
    }
  });
  if (same) throw new InputError(`Refusing to write over the input ${target}; choose another output file.`);
  if (existing && !existing.isFile() && !existing.isDirectory()) {
    try {
      fs.writeFileSync(destination, content);
    } catch (error) {
      throw new InputError(`Cannot write ${target}: ${writeProblem(error, destination)}`);
    }
    return destination;
  }
  const existingMode = existing ? existing.mode & 0o7777 : undefined;
  const finalMode = forceMode ? mode : existingMode !== undefined ? (mode === undefined ? existingMode : existingMode & mode) : (mode ?? 0o666);
  // A fresh, unpredictable name opened exclusively: nothing planted at that path (a symlink) is followed.
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { mode: finalMode, flag: 'wx' });
    if (existingMode !== undefined || forceMode) fs.chmodSync(temporary, finalMode);
    fs.renameSync(temporary, destination);
  } catch (error) {
    if (error.code !== 'EEXIST') fs.rmSync(temporary, { force: true });
    throw new InputError(`Cannot write ${target}: ${writeProblem(error, destination)}`);
  }
  return destination;
}

function writeProblem(error, destination) {
  const folder = path.dirname(destination);
  if (error.code === 'ENOENT' && !fs.existsSync(folder)) return `the folder ${folder} does not exist.`;
  if (error.code === 'EACCES' || error.code === 'EPERM') return 'permission denied.';
  if (error.code === 'EISDIR') return 'it is a folder.';
  return error.message;
}
