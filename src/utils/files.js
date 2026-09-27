import { formatBytes } from './json';

// Beyond this the editor and the views get too slow to be useful.
export const MAX_FILE_SIZE = 100 * 1024 * 1024;
const BINARY_TYPE = /^(image\/(?!svg)|audio\/|video\/|font\/)|^application\/(pdf|zip|x-zip-compressed|gzip|x-gzip|x-tar|x-7z-compressed|x-rar-compressed|x-bzip2|wasm)$/i;

function readBytes(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** Text never contains NUL bytes, except UTF-16, which starts with a byte order mark. */
async function looksBinary(file) {
  try {
    const bytes = await readBytes(file.slice(0, 4096));
    const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
    return !utf16 && bytes.includes(0);
  } catch {
    return false;
  }
}

/** Reads a picked or dropped file, refusing ones that are clearly not text or are too large. */
export async function readTextFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`it is ${formatBytes(file.size)}, and files up to ${formatBytes(MAX_FILE_SIZE)} can be opened.`);
  }
  if (BINARY_TYPE.test(file.type) || (await looksBinary(file))) {
    throw new Error(`it is not a text file${file.type ? ` (${file.type})` : ''}.`);
  }
  return readFileAsText(file);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadUrl(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function downloadText(text, filename, mimeType = 'application/json') {
  downloadBlob(new Blob([text], { type: `${mimeType};charset=utf-8` }), filename);
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or unsupported — fall back to execCommand below.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

export function suggestFileName(name, fallback = 'data.json') {
  const trimmed = (name || '').trim();
  if (!trimmed) return fallback;
  return /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.json`;
}
