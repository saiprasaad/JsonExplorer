import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import MyLocationRoundedIcon from '@mui/icons-material/MyLocationRounded';
import UnfoldLessRoundedIcon from '@mui/icons-material/UnfoldLessRounded';
import UnfoldMoreRoundedIcon from '@mui/icons-material/UnfoldMoreRounded';
import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { copyText } from '../utils/files';
import { isImpreciseNumber } from '../utils/graph';
import { formatPath, PATH_FORMATS, sliceText, valueJsonText } from '../utils/json';
import {
  ancestorIds,
  computeExpansion,
  flattenTree,
  pathToTreeId,
  previewContainer,
  rowPath,
  searchTree,
  TREE_EXPAND_ALL_ROWS,
  TREE_ROOT_ID,
} from '../utils/tree';
import { APPROX_TITLE } from './graph/GraphNodes';
import { useNotify } from './Notifier';
import { highlightText, SearchBox } from './SearchBox';
import { ToolButton } from './ToolButton';

const ROW_HEIGHT = 24;
const OVERSCAN = 12;
const SEARCH_LIMIT = 5000;

function valueClass(value) {
  if (value === null) return 'null';
  return typeof value;
}

function formatPrimitive(value) {
  if (typeof value === 'string') return JSON.stringify(value.length > 500 ? `${sliceText(value, 499)}…` : value);
  return String(value);
}

const TreeRow = memo(function TreeRow({ row, index, top, selected, matchState, query, onToggle, onSelect, onCopy }) {
  const isRoot = row.parent === -1;
  const isIndex = typeof row.key === 'number';
  const expandable = row.count > 0;

  return (
    <div
      id={`je-tree-row-${index}`}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={expandable ? row.expanded : undefined}
      aria-selected={selected}
      className={`je-tree-row${selected ? ' is-selected' : ''}${matchState ? ` is-${matchState}` : ''}`}
      style={{ transform: `translateY(${top}px)`, '--depth': row.depth }}
      onClick={(event) => onSelect(index, event)}
      onDoubleClick={() => expandable && onToggle(index)}
    >
      <span className="je-tree-indent" aria-hidden="true" />
      {expandable ? (
        <button
          type="button"
          tabIndex={-1}
          className={`je-tree-toggle${row.expanded ? ' is-open' : ''}`}
          aria-label={row.expanded ? 'Collapse' : 'Expand'}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(index);
          }}
        >
          <ChevronRightRoundedIcon fontSize="inherit" />
        </button>
      ) : (
        <span className="je-tree-toggle-spacer" />
      )}
      <span className={`je-tree-key${isIndex ? ' is-index' : ''}${isRoot ? ' is-root' : ''}`}>
        {isRoot ? 'root' : highlightText(String(row.key), isIndex ? '' : query)}
      </span>
      {!isRoot && <span className="je-tree-colon">:</span>}
      {row.container ? (
        <>
          <span className={`je-node-chip is-${Array.isArray(row.value) ? 'array' : 'object'}`}>
            {Array.isArray(row.value) ? `[${row.count.toLocaleString('en-US')}]` : `{${row.count.toLocaleString('en-US')}}`}
          </span>
          {!row.expanded && row.count > 0 && <span className="je-tree-preview">{previewContainer(row.value)}</span>}
        </>
      ) : (
        <span className={`je-tree-value je-v is-${valueClass(row.value)}`}>
          {isImpreciseNumber(row.value) && (
            <span className="je-approx" title={APPROX_TITLE}>
              ≈
            </span>
          )}
          {highlightText(formatPrimitive(row.value), query)}
        </span>
      )}
      <span className="je-tree-actions">
        <button type="button" tabIndex={-1} className="je-icon-btn is-small" aria-label="Copy path" title="Copy path" onClick={(event) => onCopy(index, 'path', event)}>
          <LinkRoundedIcon fontSize="inherit" />
        </button>
        <button type="button" tabIndex={-1} className="je-icon-btn is-small" aria-label="Copy value" title="Copy value" onClick={(event) => onCopy(index, 'value', event)}>
          <ContentCopyRoundedIcon fontSize="inherit" />
        </button>
      </span>
    </div>
  );
});

// Copy value takes the exact source text for values up to this size (so large integers keep every digit).
const MAX_EXACT_COPY = 2_000_000;

export function TreeView({
  apiRef,
  value: latestValue,
  sourceText,
  docVersion,
  active,
  selection,
  onSelectPath,
  onClearSelection,
  followCursor,
  onToggleFollowCursor,
}) {
  const notify = useNotify();
  // While hidden, keep the last shown value so edits don't re-flatten a large tree; catch up when shown.
  const [value, setShownValue] = useState(latestValue);
  if (active && value !== latestValue) setShownValue(latestValue);
  const scrollRef = useRef(null);
  const searchApiRef = useRef(null);
  const [expanded, setExpanded] = useState(() => computeExpansion(value));
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [pendingScroll, setPendingScroll] = useState(null);
  const [pathFormat] = usePersistentState('pathFormat', 'jsonpath', {
    validate: (candidate) => PATH_FORMATS.some((format) => format.id === candidate),
  });

  // A newly loaded document resets expansion — computed from the new value once the view is shown.
  const [trackedVersion, setTrackedVersion] = useState(docVersion);
  if (active && trackedVersion !== docVersion) {
    setTrackedVersion(docVersion);
    setExpanded(computeExpansion(latestValue));
    setPendingScroll({ id: TREE_ROOT_ID, align: 'top' });
  }

  const rows = useMemo(() => flattenTree(value, expanded), [value, expanded]);
  const indexById = useMemo(() => new Map(rows.map((row, index) => [row.id, index])), [rows]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setViewportHeight(entry.contentRect.height || 600));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /* ─── Selection ─── */
  const selectedId = selection ? pathToTreeId(selection.path) : null;
  const selectedIndex = selectedId !== null ? indexById.get(selectedId) ?? -1 : -1;

  const revealId = useCallback((id, align = 'center') => {
    setExpanded((previous) => {
      const missing = ancestorIds(id).filter((ancestor) => !previous.has(ancestor));
      if (missing.length === 0) return previous;
      const next = new Set(previous);
      missing.forEach((ancestor) => next.add(ancestor));
      return next;
    });
    setPendingScroll({ id, align, key: Date.now() });
  }, []);

  useEffect(() => {
    if (!pendingScroll || !active) return;
    const index = indexById.get(pendingScroll.id);
    const element = scrollRef.current;
    if (index === undefined || !element) return;
    const rowTop = index * ROW_HEIGHT;
    const { clientHeight } = element;
    const visible = rowTop >= element.scrollTop && rowTop + ROW_HEIGHT <= element.scrollTop + clientHeight;
    if (pendingScroll.align === 'top') element.scrollTop = 0;
    else if (pendingScroll.align === 'nearest') {
      if (rowTop < element.scrollTop) element.scrollTop = rowTop;
      else if (rowTop + ROW_HEIGHT > element.scrollTop + clientHeight) element.scrollTop = rowTop + ROW_HEIGHT - clientHeight;
    } else if (!visible) {
      element.scrollTop = Math.max(0, rowTop - clientHeight / 2 + ROW_HEIGHT / 2);
    }
    setScrollTop(element.scrollTop);
    setPendingScroll(null);
  }, [active, indexById, pendingScroll]);

  const handledSelectionRef = useRef(null);
  useEffect(() => {
    if (!selection || !active || handledSelectionRef.current === selection.key) return;
    handledSelectionRef.current = selection.key;
    if (selection.origin !== 'tree') revealId(pathToTreeId(selection.path), selection.origin === 'tree-keyboard' ? 'nearest' : 'center');
  }, [active, revealId, selection]);

  /* ─── Search ─── */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 150);
    return () => clearTimeout(timer);
  }, [query]);
  const matches = useMemo(() => searchTree(value, debouncedQuery, SEARCH_LIMIT), [value, debouncedQuery]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const safeMatchIndex = matches.length ? Math.min(matchIndex, matches.length - 1) : 0;
  const revealedQueryRef = useRef('');

  useEffect(() => {
    if (debouncedQuery === revealedQueryRef.current) return;
    revealedQueryRef.current = debouncedQuery;
    setMatchIndex(0);
    if (matches.length > 0) revealId(matches[0]);
  }, [debouncedQuery, matches, revealId]);

  const goToMatch = (step) => {
    if (matches.length === 0) return;
    const next = (safeMatchIndex + step + matches.length) % matches.length;
    setMatchIndex(next);
    revealId(matches[next]);
  };

  /* ─── Actions ─── */
  const toggle = useCallback(
    (index) => {
      const row = rows[index];
      if (!row || row.count === 0) return;
      setExpanded((previous) => {
        const next = new Set(previous);
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        return next;
      });
    },
    [rows]
  );

  const select = useCallback(
    (index, event) => {
      if (event?.target?.closest('.je-tree-actions')) return;
      onSelectPath(rowPath(rows, index), { origin: 'tree' });
      scrollRef.current?.focus({ preventScroll: true });
    },
    [onSelectPath, rows]
  );

  const copy = useCallback(
    async (index, kind, event) => {
      event.stopPropagation();
      const path = rowPath(rows, index);
      const content = kind === 'path' ? formatPath(path, pathFormat) : valueJsonText(sourceText, path, rows[index].value, MAX_EXACT_COPY).text;
      const copied = await copyText(content);
      notify(copied ? `${kind === 'path' ? 'Path' : 'Value'} copied to the clipboard.` : 'Copy failed.', copied ? 'success' : 'error');
    },
    [notify, pathFormat, rows, sourceText]
  );

  const expandAll = () => {
    const next = computeExpansion(value, TREE_EXPAND_ALL_ROWS);
    setExpanded(next);
    const total = flattenTree(value, next).length;
    if (total >= TREE_EXPAND_ALL_ROWS * 0.9) notify(`Expanded ${total.toLocaleString('en-US')} rows — deeper levels stay collapsed to keep things fast.`, 'info');
  };

  const collapseAll = () => {
    setExpanded(new Set([TREE_ROOT_ID]));
    setPendingScroll({ id: TREE_ROOT_ID, align: 'top' });
  };

  const moveTo = (index) => {
    const clamped = Math.max(0, Math.min(rows.length - 1, index));
    onSelectPath(rowPath(rows, clamped), { openDetails: false, origin: 'tree-keyboard' });
  };

  const handleKeyDown = (event) => {
    if (event.target !== scrollRef.current) return;
    const current = selectedIndex;
    const row = rows[current];
    const page = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT) - 1);
    switch (event.key) {
      case 'ArrowDown':
        moveTo(current < 0 ? 0 : current + 1);
        break;
      case 'ArrowUp':
        moveTo(current < 0 ? 0 : current - 1);
        break;
      case 'PageDown':
        moveTo(current + page);
        break;
      case 'PageUp':
        moveTo(current - page);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(rows.length - 1);
        break;
      case 'ArrowRight':
        if (!row) moveTo(0);
        else if (row.count > 0 && !row.expanded) toggle(current);
        else if (row.expanded) moveTo(current + 1);
        break;
      case 'ArrowLeft':
        if (!row) moveTo(0);
        else if (row.expanded) toggle(current);
        else if (row.parent >= 0) moveTo(row.parent);
        break;
      case ' ':
        if (row) toggle(current);
        break;
      case 'Enter':
        if (row) onSelectPath(rowPath(rows, current), { origin: 'tree' });
        break;
      case 'Escape':
        onClearSelection();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  useImperativeHandle(apiRef, () => ({ focusSearch: () => searchApiRef.current?.focus() }), []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const currentMatchId = matches[safeMatchIndex];
  const visibleRows = [];
  for (let index = start; index < end; index += 1) {
    const row = rows[index];
    const matchState = row.id === currentMatchId ? 'match-current' : matchSet.has(row.id) ? 'match' : null;
    visibleRows.push(
      <TreeRow
        key={row.id}
        row={row}
        index={index}
        top={index * ROW_HEIGHT}
        selected={index === selectedIndex}
        matchState={matchState}
        query={matchState ? debouncedQuery : ''}
        onToggle={toggle}
        onSelect={select}
        onCopy={copy}
      />
    );
  }

  return (
    <div className="je-tree">
      <div className="je-tree-toolbar">
        <SearchBox
          apiRef={searchApiRef}
          className="je-tree-search"
          value={query}
          onChange={setQuery}
          count={matches.length}
          index={safeMatchIndex}
          limit={SEARCH_LIMIT}
          onNext={() => goToMatch(1)}
          onPrevious={() => goToMatch(-1)}
        />
        <span className="je-toolbar-spacer" />
        <ToolButton label="Expand all" icon={<UnfoldMoreRoundedIcon fontSize="small" />} onClick={expandAll} />
        <ToolButton label="Collapse all" icon={<UnfoldLessRoundedIcon fontSize="small" />} onClick={collapseAll} />
        {onToggleFollowCursor && (
          <ToolButton
            label={followCursor ? 'Following the editor cursor (click to stop)' : 'Follow the editor cursor'}
            icon={<MyLocationRoundedIcon fontSize="small" />}
            active={followCursor}
            onClick={onToggleFollowCursor}
          />
        )}
      </div>
      <div
        ref={scrollRef}
        className="je-tree-scroll"
        role="tree"
        aria-label="JSON tree. Use arrow keys to navigate, Space to expand or collapse, Enter for details."
        aria-activedescendant={selectedIndex >= start && selectedIndex < end ? `je-tree-row-${selectedIndex}` : undefined}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="je-tree-canvas" style={{ height: rows.length * ROW_HEIGHT }}>
          {visibleRows}
        </div>
      </div>
      <div className="je-tree-footer" role="status">
        {rows.length.toLocaleString('en-US')} rows visible
        {selectedIndex >= 0 && <span className="je-tree-footer-path">{formatPath(rowPath(rows, selectedIndex), pathFormat)}</span>}
      </div>
    </div>
  );
}
