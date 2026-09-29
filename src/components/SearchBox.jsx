import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { useImperativeHandle, useRef } from 'react';

/** Search field with a result counter and next/previous navigation (Enter / Shift+Enter). */
export function SearchBox({
  apiRef,
  value,
  onChange,
  count,
  index,
  onNext,
  onPrevious,
  placeholder = 'Search keys and values…',
  label = 'Search the document',
  className = '',
  limit,
}) {
  const inputRef = useRef(null);

  useImperativeHandle(apiRef, () => ({
    focus: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  }));

  const hasQuery = value.trim().length > 0;
  const countLabel = count >= limit ? `${limit.toLocaleString('en-US')}+` : count.toLocaleString('en-US');

  return (
    <div className={`je-search ${className}`.trim()} role="search">
      <SearchRoundedIcon fontSize="small" className="je-search-icon" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          } else if (event.key === 'Escape') {
            event.stopPropagation();
            if (value) onChange('');
            else event.currentTarget.blur();
          }
        }}
      />
      {hasQuery && (
        <span className={`je-search-count${count === 0 ? ' is-empty' : ''}`} aria-live="polite">
          {count === 0 ? 'No results' : `${index + 1} / ${countLabel}`}
        </span>
      )}
      <span className="je-search-divider" />
      <button type="button" className="je-icon-btn is-small" onClick={onPrevious} disabled={count === 0} aria-label="Previous result (Shift+Enter)">
        <KeyboardArrowUpRoundedIcon fontSize="small" />
      </button>
      <button type="button" className="je-icon-btn is-small" onClick={onNext} disabled={count === 0} aria-label="Next result (Enter)">
        <KeyboardArrowDownRoundedIcon fontSize="small" />
      </button>
      <button
        type="button"
        className="je-icon-btn is-small"
        onClick={() => {
          onChange('');
          inputRef.current?.focus();
        }}
        disabled={!value}
        aria-label="Clear search"
      >
        <CloseRoundedIcon fontSize="small" />
      </button>
    </div>
  );
}

/** Splits `text` around case-insensitive matches of `query`, wrapping matches in <mark>. */
export function highlightText(text, query) {
  if (!query) return text;
  const needle = query.toLowerCase();
  const haystack = String(text);
  const lower = haystack.toLowerCase();
  let index = lower.indexOf(needle);
  if (index === -1) return haystack;
  const parts = [];
  let cursor = 0;
  while (index !== -1) {
    if (index > cursor) parts.push(haystack.slice(cursor, index));
    parts.push(
      <mark key={index} className="je-mark">
        {haystack.slice(index, index + needle.length)}
      </mark>
    );
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }
  if (cursor < haystack.length) parts.push(haystack.slice(cursor));
  return parts;
}
