/** @jest-environment jsdom */
import { buildViewerPage, DATA_MARKER, embedJson, escapeHtml, TITLE_MARKER } from './html';

const TEMPLATE = `<!doctype html><html><head><title>${TITLE_MARKER}</title></head><body><div id="root"></div><script type="application/json" id="je-data">${DATA_MARKER}</script><script>window.ran = true;</script></body></html>`;

// Everything a hostile document might try in order to break out of the data block.
const HOSTILE = [
  '</script><script>alert(1)</script>',
  '</SCRIPT ><img src=x onerror=alert(1)>',
  '<!--<script>',
  '<![CDATA[ ]]>',
  '"; alert(1); //',
  '\u2028\u2029',
  '$& $1 $$ $` $\'',
  '&lt;&amp;&#x3C;',
  '\\u003c/script>',
  '\ud83d\ude00 emoji',
];

function parse(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('embedJson', () => {
  it('escapes everything that could end a script element or be read as markup', () => {
    const text = embedJson({ value: HOSTILE.join('') });
    expect(text).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(text)).toEqual({ value: HOSTILE.join('') });
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
  });
});

describe('buildViewerPage', () => {
  it('embeds the payload so that it reads back exactly, whatever it contains', () => {
    const payload = { kind: 'document', name: HOSTILE[0], text: JSON.stringify(HOSTILE), extra: HOSTILE };
    const html = buildViewerPage(TEMPLATE, payload, HOSTILE.join(' '));
    const doc = parse(html);
    expect(doc.querySelectorAll('script')).toHaveLength(2);
    expect(doc.querySelectorAll('img, iframe')).toHaveLength(0);
    expect(JSON.parse(doc.getElementById('je-data').textContent)).toEqual(payload);
    expect(doc.title).toBe(HOSTILE.join(' '));
    expect(doc.querySelectorAll('script')[1].textContent).toBe('window.ran = true;');
  });

  it('treats "$" sequences in the data and title literally', () => {
    const html = buildViewerPage(TEMPLATE, { text: '$& $1 $$' }, '$&$`');
    expect(html).toContain('{"text":"$\\u0026 $1 $$"}');
    expect(html).toContain('<title>$&amp;$`</title>');
    expect(JSON.parse(parse(html).getElementById('je-data').textContent)).toEqual({ text: '$& $1 $$' });
  });

  it('refuses a template without exactly one of each placeholder', () => {
    expect(() => buildViewerPage('<html></html>', {}, 't')).toThrow('The viewer template is damaged (missing placeholders). Reinstall the JSON Explorer skill.');
    expect(() => buildViewerPage(TEMPLATE + DATA_MARKER, {}, 't')).toThrow('damaged');
    expect(() => buildViewerPage(TEMPLATE + TITLE_MARKER, {}, 't')).toThrow('damaged');
  });
});
