import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import SwapVertRoundedIcon from '@mui/icons-material/SwapVertRounded';
import SyncAltRoundedIcon from '@mui/icons-material/SyncAltRounded';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { JsonHighlight } from '../components/JsonHighlight';
import { useNotify } from '../components/Notifier';
import { SearchBox } from '../components/SearchBox';
import { ToolButton } from '../components/ToolButton';
import { compilePath } from '../cli/jsonpath';
import { diffJson, withoutIgnored } from '../utils/diff';
import { copyText } from '../utils/files';
import { formatPath, parseJson, previewValue, valueJsonText } from '../utils/json';
import { isTypingTarget } from '../utils/platform';
import { ViewerHeader } from './ViewerHeader';

const PAGE = 500;
const KINDS = [
  { id: 'all', label: 'All' },
  { id: 'added', label: 'Added', icon: <AddRoundedIcon fontSize="inherit" /> },
  { id: 'removed', label: 'Removed', icon: <RemoveRoundedIcon fontSize="inherit" /> },
  { id: 'changed', label: 'Changed', icon: <SyncAltRoundedIcon fontSize="inherit" /> },
  { id: 'moved', label: 'Moved', icon: <SwapVertRoundedIcon fontSize="inherit" /> },
];
const ICONS = Object.fromEntries(KINDS.map((item) => [item.id, item.icon]));

/** Differences between the two embedded documents, honouring the report's ignore paths. */
export function computeChanges(payload) {
  const left = parseJson(payload.left.text, { exact: true });
  const right = parseJson(payload.right.text, { exact: true });
  if (!left.ok || !right.ok) {
    const failed = left.ok ? payload.right : payload.left;
    return { error: `${failed.name}: ${(left.ok ? right : left).error?.message ?? 'the document is empty.'}` };
  }
  let selectors;
  try {
    selectors = (Array.isArray(payload.ignore) ? payload.ignore : []).map((expression) => compilePath(String(expression)));
  } catch (error) {
    return { error: `The ignored path is not valid: ${error.message}` };
  }
  const arrays = payload.arrays === 'index' || payload.arrays === 'unordered' ? payload.arrays : 'align';
  const { changes } = diffJson(left.value, right.value, { limit: Infinity, arrays });
  return { changes: withoutIgnored(changes, [left.value, right.value], selectors) };
}

/** True when the value sits at a different path in the two documents (an array item moved or shifted). */
function isMoved(change) {
  return Boolean(change.leftPath && change.rightPath) && formatPath(change.leftPath) !== formatPath(change.rightPath);
}

function ValuePane({ title, side, text, onCopy }) {
  return (
    <div className={`je-diffview-pane is-${side}`}>
      <div className="je-diffview-pane-header">
        <h3>{title}</h3>
        {text !== null && <ToolButton label={`Copy the ${side === 'before' ? 'old' : 'new'} value`} icon={<ContentCopyRoundedIcon fontSize="small" />} className="is-small" onClick={() => onCopy(text)} />}
      </div>
      {text === null ? <p className="je-diffview-absent">Not present</p> : <JsonHighlight text={text} />}
    </div>
  );
}

/** The offline visual diff report: a filterable list of changes with exact before/after values. */
export function DiffViewer({ payload, themeMode, onToggleTheme }) {
  const notify = useNotify();
  const result = useMemo(() => computeChanges(payload), [payload]);
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState(0);
  const listRef = useRef(null);
  const searchApiRef = useRef(null);
  const changes = useMemo(() => result.changes ?? [], [result]);
  const counts = useMemo(() => {
    const totals = { all: changes.length, added: 0, removed: 0, changed: 0, moved: 0 };
    changes.forEach((change) => {
      totals[change.kind] += 1;
    });
    return totals;
  }, [changes]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return changes.filter(
      (change) =>
        (kind === 'all' || change.kind === kind) &&
        (!needle || formatPath(change.path).toLowerCase().includes(needle) || (isMoved(change) && formatPath(change.leftPath).toLowerCase().includes(needle)))
    );
  }, [changes, kind, query]);
  const index = Math.min(selected, filtered.length - 1);
  const current = filtered[index] ?? null;

  const select = useCallback(
    (next, { focus = false } = {}) => {
      if (filtered.length === 0) return;
      const wrapped = (next + filtered.length) % filtered.length;
      setSelected(wrapped);
      if (wrapped >= limit) setLimit(Math.ceil((wrapped + 1) / PAGE) * PAGE);
      requestAnimationFrame(() => {
        const row = listRef.current?.querySelector(`[data-index="${wrapped}"]`);
        row?.scrollIntoView?.({ block: 'nearest' });
        if (focus) row?.focus();
      });
    },
    [filtered.length, limit]
  );

  const copy = useCallback(
    async (text) => {
      const copied = await copyText(text);
      notify(copied ? 'Value copied to the clipboard.' : 'The browser blocked copying.', copied ? 'success' : 'error');
    },
    [notify]
  );

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      if (event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f')) {
        event.preventDefault();
        searchApiRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleListKeyDown = (event) => {
    const moves = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: filtered.length - 1, j: index + 1, k: index - 1 };
    if (!(event.key in moves) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    select(moves[event.key], { focus: true });
  };

  const meta = result.error ? 'could not be compared' : changes.length === 0 ? 'no differences' : `${changes.length.toLocaleString('en-US')} difference${changes.length === 1 ? '' : 's'}`;

  return (
    <div className="je-app je-standalone">
      <ViewerHeader title={`${payload.left.name} → ${payload.right.name}`} meta={meta} themeMode={themeMode} onToggleTheme={onToggleTheme} generator={payload.generator} />
      <main className="je-main je-diffview">
        {result.error ? (
          <div className="je-empty" role="alert">
            <div className="je-empty-card is-error">
              <h2>The documents could not be compared</h2>
              <p>{result.error}</p>
            </div>
          </div>
        ) : changes.length === 0 ? (
          <div className="je-empty">
            <div className="je-empty-card">
              <h2>No differences</h2>
              <p>Both documents contain the same data{payload.ignore?.length ? ' outside the ignored paths' : ''}. Key order and formatting are ignored.</p>
            </div>
          </div>
        ) : (
          <>
            <section className="je-diffview-list" aria-label="Differences">
              <div className="je-diffview-toolbar">
                <div className="je-segmented" role="group" aria-label="Show">
                  {KINDS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={kind === item.id}
                      onClick={() => {
                        setKind(item.id);
                        setSelected(0);
                        setLimit(PAGE);
                      }}
                    >
                      {item.icon}
                      {item.label}
                      <span className="je-diffview-count">{counts[item.id].toLocaleString('en-US')}</span>
                    </button>
                  ))}
                </div>
                <SearchBox
                  apiRef={searchApiRef}
                  className="je-diffview-search"
                  value={query}
                  onChange={(next) => {
                    setQuery(next);
                    setSelected(0);
                    setLimit(PAGE);
                  }}
                  count={filtered.length}
                  index={Math.max(index, 0)}
                  onNext={() => select(index + 1)}
                  onPrevious={() => select(index - 1)}
                  placeholder="Filter by path"
                  label="Filter the differences by path"
                />
              </div>
              <ul className="je-diff-list" ref={listRef} onKeyDown={handleListKeyDown}>
                {filtered.slice(0, limit).map((change, position) => (
                  <li key={`${change.kind}:${JSON.stringify(change.leftPath)}:${JSON.stringify(change.rightPath)}`}>
                    <button
                      type="button"
                      data-index={position}
                      className={`je-diff-row is-${change.kind}${current === change ? ' is-selected' : ''}`}
                      aria-current={current === change ? 'true' : undefined}
                      onClick={() => setSelected(position)}
                    >
                      <span className="je-diff-kind" aria-label={change.kind}>
                        {ICONS[change.kind]}
                      </span>
                      <code className="je-diff-path">{formatPath(change.path)}</code>
                      <span className="je-diff-values">
                        {change.kind !== 'added' && change.kind !== 'moved' && <span className="je-diff-before">{previewValue(change.before, 40)}</span>}
                        {change.kind === 'changed' && (
                          <span className="je-diff-arrow" aria-hidden="true">
                            →
                          </span>
                        )}
                        {change.kind !== 'removed' && <span className="je-diff-after">{previewValue(change.after, 40)}</span>}
                        {change.typeChanged && <span className="je-diff-note">type changed</span>}
                        {isMoved(change) && (
                          <span className="je-diff-was">
                            {change.kind === 'moved' ? 'from' : 'was'} {formatPath(change.leftPath)}
                          </span>
                        )}
                        {change.kind === 'moved' && !isMoved(change) && <span className="je-diff-was">order changed</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {filtered.length === 0 && <p className="je-diffview-none">No differences match the filter.</p>}
              {filtered.length > limit && (
                <button type="button" className="je-button je-diffview-more" onClick={() => setLimit((value) => value + PAGE)}>
                  Show {Math.min(PAGE, filtered.length - limit).toLocaleString('en-US')} more of {(filtered.length - limit).toLocaleString('en-US')}
                </button>
              )}
            </section>
            <section className="je-diffview-detail" aria-label="Selected difference" aria-live="polite">
              {current ? (
                <>
                  <h2 className="je-diffview-path">
                    <span className={`je-diffview-kind is-${current.kind}`}>{KINDS.find((item) => item.id === current.kind).label}</span>
                    <code>{formatPath(current.path)}</code>
                    {isMoved(current) && <span className="je-muted">was {formatPath(current.leftPath)}</span>}
                  </h2>
                  <div className="je-diffview-panes">
                    <ValuePane
                      side="before"
                      title={`Before · ${payload.left.name}`}
                      text={current.leftPath ? valueJsonText(payload.left.text, current.leftPath, current.before).text : null}
                      onCopy={copy}
                    />
                    <ValuePane
                      side="after"
                      title={`After · ${payload.right.name}`}
                      text={current.rightPath ? valueJsonText(payload.right.text, current.rightPath, current.after).text : null}
                      onCopy={copy}
                    />
                  </div>
                </>
              ) : (
                <p className="je-muted">Select a difference to see both values.</p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
