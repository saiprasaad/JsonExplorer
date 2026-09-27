import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

const HASH_KEY = 'json';
// Longer URLs work in browsers but get truncated by chat apps, email clients and proxies.
export const MAX_SHARE_URL_LENGTH = 60000;

export function encodeShareText(text) {
  return compressToEncodedURIComponent(text);
}

export function decodeShareText(encoded) {
  const text = decompressFromEncodedURIComponent(encoded);
  if (text === null || text === undefined || (text === '' && encoded !== '')) {
    throw new Error('The shared link is corrupted or incomplete.');
  }
  return text;
}

export function buildShareUrl(text, location = window.location) {
  return `${location.origin}${location.pathname}#${HASH_KEY}=${encodeShareText(text)}`;
}

/** Returns the shared JSON text from a `#json=…` hash, `null` if absent. Throws when corrupted. */
export function readSharedText(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const encoded = params.get(HASH_KEY);
  return encoded === null ? null : decodeShareText(encoded);
}

export function clearShareHash() {
  if (window.location.hash) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }
}
