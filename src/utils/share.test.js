import { buildShareUrl, decodeShareText, encodeShareText, readSharedText } from './share';

describe('share links', () => {
  const text = '{\n  "greeting": "héllo 👋",\n  "list": [1, 2, 3]\n}';

  test('round-trips text through the URL-safe encoding', () => {
    const encoded = encodeShareText(text);
    expect(encoded).toMatch(/^[A-Za-z0-9+\-$]+$/);
    expect(decodeShareText(encoded)).toBe(text);
  });

  test('builds a URL that readSharedText can decode', () => {
    const url = buildShareUrl(text, { origin: 'https://example.com', pathname: '/' });
    expect(url.startsWith('https://example.com/#json=')).toBe(true);
    expect(readSharedText(new URL(url).hash)).toBe(text);
  });

  test('returns null when the hash has no shared JSON', () => {
    expect(readSharedText('')).toBeNull();
    expect(readSharedText('#other=1')).toBeNull();
  });

  test('throws on corrupted payloads', () => {
    expect(() => readSharedText('#json=%%%not-valid')).toThrow(/corrupted/);
  });
});
