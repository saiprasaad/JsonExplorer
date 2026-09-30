import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded';
import SchemaRoundedIcon from '@mui/icons-material/SchemaRounded';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConvertDialog } from '../components/ConvertDialog';
import { DetailsPanel } from '../components/DetailsPanel';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { JsonViewer } from '../components/JsonViewer';
import { TreeView } from '../components/TreeView';
import { computeStats, formatBytes, formatPath, getValueAtPath, mayContainInexactNumbers, parseJson } from '../utils/json';
import { isTypingTarget } from '../utils/platform';
import { ViewerHeader } from './ViewerHeader';

const VIEWS = [
  { id: 'graph', label: 'Graph', icon: <SchemaRoundedIcon fontSize="small" /> },
  { id: 'tree', label: 'Tree', icon: <AccountTreeRoundedIcon fontSize="small" /> },
];

/** The offline viewer for one document: graph and tree views, details, search and conversions. */
export function DocumentViewer({ payload, themeMode, onToggleTheme }) {
  const compact = useMediaQuery('(max-width: 760px)', { noSsr: true });
  const parsed = useMemo(() => parseJson(payload.text), [payload.text]);
  const value = parsed.ok ? parsed.value : undefined;
  const stats = useMemo(() => (parsed.ok ? computeStats(value) : null), [parsed.ok, value]);
  const [view, setView] = useState(payload.view === 'tree' ? 'tree' : 'graph');
  const [mounted, setMounted] = useState(() => new Set([view]));
  const [selection, setSelection] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState(null);
  const viewerApiRef = useRef(null);

  const changeView = useCallback((next) => {
    setView(next);
    setMounted((previous) => (previous.has(next) ? previous : new Set([...previous, next])));
  }, []);

  const selectPath = useCallback((path, { openDetails = true, origin = 'viewer' } = {}) => {
    setSelection({ path, origin, key: Date.now() });
    if (openDetails) setDetailsOpen(true);
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(null);
    setDetailsOpen(false);
  }, []);

  const openConvert = useCallback(
    (path) => {
      // Exports use exact numbers, parsed again from the embedded text when it holds any.
      const exact = mayContainInexactNumbers(payload.text) ? parseJson(payload.text, { exact: true }) : null;
      const last = path[path.length - 1];
      setConvertTarget({
        value: getValueAtPath(exact?.ok ? exact.value : value, path),
        label: path.length ? formatPath(path) : payload.name,
        name: typeof last === 'string' ? last : path.length === 0 ? payload.name : null,
        key: Date.now(),
      });
    },
    [payload.name, payload.text, value]
  );

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented) return;
      const typing = isTypingTarget(event.target);
      const viewIndex = { Digit1: 0, Digit2: 1 }[event.code];
      if (event.altKey && !event.ctrlKey && !event.metaKey && viewIndex !== undefined) {
        event.preventDefault();
        changeView(VIEWS[viewIndex].id);
      } else if (!typing && event.key === '/') {
        event.preventDefault();
        viewerApiRef.current?.focusSearch();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        viewerApiRef.current?.focusSearch();
      } else if (!typing && event.key === 'Escape' && detailsOpen) {
        setDetailsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [changeView, detailsOpen]);

  const handleTabKeyDown = (event) => {
    const index = VIEWS.findIndex((item) => item.id === view);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: VIEWS.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = VIEWS[(next + VIEWS.length) % VIEWS.length];
    changeView(target.id);
    event.currentTarget.querySelector(`[data-view="${target.id}"]`)?.focus();
  };

  const meta = stats
    ? `${formatBytes(payload.bytes ?? payload.text.length)} · ${stats.values.toLocaleString('en-US')} values · depth ${stats.maxDepth}`
    : formatBytes(payload.bytes ?? payload.text.length);

  return (
    <div className="je-app je-standalone">
      <ViewerHeader title={payload.name} meta={meta} themeMode={themeMode} onToggleTheme={onToggleTheme} generator={payload.generator}>
        {parsed.ok && (
          <div className="je-tabs" role="tablist" aria-label="Views" onKeyDown={handleTabKeyDown}>
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`je-tab-${item.id}`}
                data-view={item.id}
                aria-selected={view === item.id}
                tabIndex={view === item.id ? 0 : -1}
                aria-controls="je-panel-explore"
                className="je-tab"
                title={`${item.label} (Alt+${VIEWS.indexOf(item) + 1})`}
                onClick={() => changeView(item.id)}
              >
                {item.icon}
                <span className="je-tab-label">{item.label}</span>
              </button>
            ))}
          </div>
        )}
      </ViewerHeader>

      <main className="je-main">
        <div id="je-panel-explore" role="tabpanel" aria-labelledby={`je-tab-${view}`} className={`je-explore${compact ? ' is-compact' : ''} pane-viewer`}>
          <section className="je-viewer" aria-label={view === 'tree' ? 'Tree view' : 'Graph view'}>
            {!parsed.ok ? (
              <div className="je-empty" role="alert">
                <div className="je-empty-card is-error">
                  <h2>This page’s data could not be read</h2>
                  <p>{parsed.error?.message ?? 'The embedded document is empty.'}</p>
                </div>
              </div>
            ) : (
              <>
                {(mounted.has('graph') || view === 'graph') && (
                  <div className="je-view-host" hidden={view !== 'graph'}>
                    <ErrorBoundary resetKey={value}>
                      <JsonViewer
                        apiRef={view === 'graph' ? viewerApiRef : undefined}
                        value={value}
                        docVersion={0}
                        active={view === 'graph'}
                        selection={selection}
                        onSelectPath={selectPath}
                        onClearSelection={clearSelection}
                        detailsOpen={detailsOpen}
                        compact={compact}
                      />
                    </ErrorBoundary>
                  </div>
                )}
                {(mounted.has('tree') || view === 'tree') && (
                  <div className="je-view-host" hidden={view !== 'tree'}>
                    <ErrorBoundary resetKey={value}>
                      <TreeView
                        apiRef={view === 'tree' ? viewerApiRef : undefined}
                        value={value}
                        sourceText={payload.text}
                        docVersion={0}
                        active={view === 'tree'}
                        selection={selection}
                        onSelectPath={selectPath}
                        onClearSelection={clearSelection}
                      />
                    </ErrorBoundary>
                  </div>
                )}
                {detailsOpen && selection && (
                  <DetailsPanel
                    root={value}
                    path={selection.path}
                    sourceText={payload.text}
                    onClose={() => setDetailsOpen(false)}
                    onSelectPath={selectPath}
                    onConvert={openConvert}
                    compact={compact}
                    offline
                  />
                )}
              </>
            )}
          </section>
        </div>
      </main>
      <ConvertDialog key={convertTarget?.key} target={convertTarget} onClose={() => setConvertTarget(null)} />
    </div>
  );
}
