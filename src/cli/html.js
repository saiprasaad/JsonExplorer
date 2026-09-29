/*
 * Builds the offline viewer page: the prebuilt single-file viewer (assets/viewer.html) with the
 * data embedded in a non-executable <script type="application/json"> block. The page's Content
 * Security Policy blocks every network request, so nothing in it can send the data anywhere.
 */

export const DATA_MARKER = '/*JSON_EXPLORER_DATA*/';
export const TITLE_MARKER = '__JSON_EXPLORER_TITLE__';

/**
 * Serializes a payload so it can sit inside a <script> element: "<", ">", "&" and the JavaScript
 * line separators are escaped (inside JSON strings, where escapes are allowed), so no value can
 * close the element or be read as markup.
 */
export function embedJson(payload) {
  return JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

/** Fills the viewer template with a payload ({ kind: 'document' | 'diff', … }) and a page title. */
export function buildViewerPage(template, payload, title) {
  const places = [
    [template.indexOf(TITLE_MARKER), TITLE_MARKER, escapeHtml(title)],
    [template.indexOf(DATA_MARKER), DATA_MARKER, embedJson(payload)],
  ];
  if (places.some(([at, marker]) => at === -1 || template.lastIndexOf(marker) !== at)) {
    throw new Error('The viewer template is damaged (missing placeholders). Reinstall the JSON Explorer skill.');
  }
  // Both placeholders are filled in one pass over the template, so text inserted for one (a value
  // that happens to spell a placeholder) is never replaced again.
  let page = '';
  let cursor = 0;
  places
    .sort(([a], [b]) => a - b)
    .forEach(([at, marker, text]) => {
      page += template.slice(cursor, at) + text;
      cursor = at + marker.length;
    });
  return page + template.slice(cursor);
}
