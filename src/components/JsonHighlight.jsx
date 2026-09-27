import { memo, useMemo } from 'react';

const MAX_CHARS = 100_000;
const TOKEN_PATTERN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],]/g;

export function tokenizeJson(text) {
  const tokens = [];
  let lastIndex = 0;
  let match;
  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) tokens.push({ type: 'plain', text: text.slice(lastIndex, match.index) });
    const [token, string, colon] = match;
    if (string !== undefined) {
      if (colon !== undefined) {
        tokens.push({ type: 'key', text: string });
        tokens.push({ type: 'punct', text: colon });
      } else {
        tokens.push({ type: 'string', text: string });
      }
    } else if (token === 'true' || token === 'false') {
      tokens.push({ type: 'boolean', text: token });
    } else if (token === 'null') {
      tokens.push({ type: 'null', text: token });
    } else if (/^[{}[\],]$/.test(token)) {
      tokens.push({ type: 'punct', text: token });
    } else {
      tokens.push({ type: 'number', text: token });
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) tokens.push({ type: 'plain', text: text.slice(lastIndex) });
  return tokens;
}

/** Read-only, syntax-highlighted JSON text. Very large values are truncated for rendering speed. */
export const JsonHighlight = memo(function JsonHighlight({ text }) {
  const { tokens, truncated, length } = useMemo(() => {
    const shown = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
    return { tokens: tokenizeJson(shown), truncated: text.length > MAX_CHARS, length: text.length };
  }, [text]);

  return (
    <>
      <pre className="je-code">
        <code>
          {tokens.map((token, index) =>
            token.type === 'plain' ? token.text : (
              <span key={index} className={`je-json-${token.type}`}>
                {token.text}
              </span>
            )
          )}
        </code>
      </pre>
      {truncated && (
        <p className="je-code-note">
          Showing the first {MAX_CHARS.toLocaleString('en-US')} of {length.toLocaleString('en-US')} characters. Copy the value to get
          all of it.
        </p>
      )}
    </>
  );
});
