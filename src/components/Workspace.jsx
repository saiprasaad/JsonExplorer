import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import KeyboardDoubleArrowRightRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowRightRounded';
import SchemaRoundedIcon from '@mui/icons-material/SchemaRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import useMediaQuery from '@mui/material/useMediaQuery';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { DEFAULT_COMPARE_JSON, SAMPLES } from '../samples';
import { copyText, readFileAsText } from '../utils/files';
import { computeStats, formatBytes, getValueAtPath, parseJson } from '../utils/json';
import { hasModifier, isMac, isTypingTarget } from '../utils/platform';
import { buildShareUrl, clearShareHash, MAX_SHARE_URL_LENGTH, readSharedText } from '../utils/share';
import { loadSetting, loadText, saveSetting, saveText } from '../utils/storage';
import { AppHeader, VIEWS } from './AppHeader';
import { DetailsPanel } from './DetailsPanel';
import { ErrorBoundary } from './ErrorBoundary';
import { JsonEditor } from './JsonEditor';
import { JsonViewer } from './JsonViewer';
import { useNotify } from './Notifier';
import { ShortcutsDialog } from './ShortcutsDialog';
import { ToolButton } from './ToolButton';
import { UrlDialog } from './UrlDialog';

// Secondary views load on first use to keep the initial bundle small.
const JsonCompare = lazy(() => import('./JsonCompare').then((module) => ({ default: module.JsonCompare })));
const TreeView = lazy(() => import('./TreeView').then((module) => ({ default: module.TreeView })));

function ViewLoading() {
  return (
    <div className="je-view-loading" role="status" aria-label="Loading">
      <span className="je-spinner" />
    </div>
  );
}

export const EMBED_MESSAGE_TYPE = 'json-explorer:set-json';
export const EMBED_READY_MESSAGE_TYPE = 'json-explorer:ready';

const VIEW_IDS = VIEWS.map((view) => view.id);
const MIN_EDITOR_WIDTH = 280;
const DEFAULT_EDITOR_WIDTH = 420;

function createParseState(text, previous = null) {
  const result = parseJson(text);
  const lastValid = result.ok ? { value: result.value, text } : result.empty ? null : previous?.lastValid ?? null;
  return { text, result, lastValid };
}

function fileNameFromUrl(url) {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop();
    return segment && /\.[a-z0-9]+$/i.test(segment) ? decodeURIComponent(segment) : null;
  } catch {
    return null;
  }
}

async function fetchJsonText(url) {
  let response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' } });
  } catch {
    throw new Error('Network error — the server is unreachable or does not allow cross-origin (CORS) requests.');
  }
  if (!response.ok) {
    throw new Error(`The server responded with ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`);
  }
  if (/text\/html/i.test(response.headers.get('content-type') || '')) {
    throw new Error('The URL returned an HTML page instead of JSON.');
  }
  return response.text();
}

function maxEditorWidth() {
  return Math.max(MIN_EDITOR_WIDTH, Math.min(960, window.innerWidth - 320));
}

/** Reads the document to start with: a shared link, then the autosave, then the default sample. */
export function readInitialDocument(launch) {
  if (launch.embed) return { text: '', fileName: null, source: 'embed' };
  let shareError = null;
  try {
    const shared = readSharedText(window.location.hash);
    if (shared !== null) return { text: shared, fileName: null, source: 'share' };
  } catch (error) {
    shareError = error.message;
  }
  const saved = loadText('document');
  if (saved !== null) return { text: saved, fileName: loadSetting('fileName', null), source: 'storage', shareError };
  return { text: SAMPLES[0].build(), fileName: null, source: 'default', shareError };
}

function Resizer({ width, onResize }) {
  const handlePointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    const startX = event.clientX;
    const startWidth = width;
    target.setPointerCapture(event.pointerId);
    target.classList.add('is-dragging');
    document.body.classList.add('je-resizing');

    const handleMove = (moveEvent) => {
      onResize(Math.round(Math.min(maxEditorWidth(), Math.max(MIN_EDITOR_WIDTH, startWidth + moveEvent.clientX - startX))));
    };
    const handleUp = () => {
      target.classList.remove('is-dragging');
      document.body.classList.remove('je-resizing');
      target.removeEventListener('pointermove', handleMove);
      target.removeEventListener('pointerup', handleUp);
      target.removeEventListener('pointercancel', handleUp);
    };
    target.addEventListener('pointermove', handleMove);
    target.addEventListener('pointerup', handleUp);
    target.addEventListener('pointercancel', handleUp);
  };

  const handleKeyDown = (event) => {
    const step = event.shiftKey ? 80 : 24;
    const next = {
      ArrowLeft: width - step,
      ArrowRight: width + step,
      Home: MIN_EDITOR_WIDTH,
      End: maxEditorWidth(),
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onResize(Math.min(maxEditorWidth(), Math.max(MIN_EDITOR_WIDTH, next)));
  };

  return (
    <div
      className="je-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize editor"
      aria-valuenow={width}
      aria-valuemin={MIN_EDITOR_WIDTH}
      aria-valuemax={maxEditorWidth()}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => onResize(DEFAULT_EDITOR_WIDTH)}
      title="Drag to resize · double-click to reset"
    />
  );
}

function EmptyState({ embed, onOpenFile, onLoadSample }) {
  return (
    <div className="je-empty">
      <div className="je-empty-card">
        <div className="je-empty-icon" aria-hidden="true">
          {'{ }'}
        </div>
        <h2>{embed ? 'No JSON loaded' : 'Nothing to explore yet'}</h2>
        {!embed && (
          <>
            <p>Paste JSON into the editor, drop a file anywhere, or start from a sample.</p>
            <div className="je-empty-actions">
              <button type="button" className="je-button is-primary" onClick={onOpenFile}>
                <UploadFileRoundedIcon fontSize="small" /> Open a file
              </button>
              <button type="button" className="je-button" onClick={onLoadSample}>
                Load sample
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Workspace({ launch, initialDocument, themeMode, onToggleTheme }) {
  const notify = useNotify();
  const embed = launch.embed;
  const compact = useMediaQuery('(max-width: 760px)', { noSsr: true });

  /* ─── Selection (shared by the graph, the tree and the details panel) ─── */
  const [selection, setSelection] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  /* ─── Document ─── */
  const [text, setText] = useState(initialDocument.text);
  const [fileName, setFileName] = useState(initialDocument.fileName);
  const [docVersion, setDocVersion] = useState(0);
  const [parseState, setParseState] = useState(() => createParseState(initialDocument.text));
  const [compareText, setCompareText] = useState(() => (embed ? DEFAULT_COMPARE_JSON : loadText('compareDocument') ?? DEFAULT_COMPARE_JSON));
  const [remote, setRemote] = useState(() => {
    if (launch.dataUrl) return { status: 'loading', message: 'Loading JSON…' };
    if (embed) return { status: 'waiting', message: 'Waiting for JSON from the parent page…' };
    return null;
  });

  const loadDocument = useCallback((nextText, { fileName: nextFileName = null } = {}) => {
    setText(nextText);
    setFileName(nextFileName);
    setParseState(createParseState(nextText));
    setDocVersion((version) => version + 1);
    setSelection(null);
    setDetailsOpen(false);
  }, []);

  // Parse edits after a short pause; bigger documents wait a little longer.
  useEffect(() => {
    if (text === parseState.text) return undefined;
    const delay = text.length > 1_000_000 ? 600 : text.length > 100_000 ? 300 : 150;
    const timer = setTimeout(() => setParseState((previous) => createParseState(text, previous)), delay);
    return () => clearTimeout(timer);
  }, [text, parseState.text]);

  const { result: parseResult, lastValid } = parseState;
  const hasValue = lastValid !== null;
  const value = hasValue ? lastValid.value : undefined;
  const isStale = hasValue && !parseResult.ok;
  const stats = useMemo(() => (hasValue ? computeStats(value) : null), [hasValue, value]);

  /* ─── Persistence ─── */
  const persistRef = useRef({ text, fileName, compareText });
  persistRef.current = { text, fileName, compareText };

  useEffect(() => {
    if (embed) return undefined;
    const timer = setTimeout(() => {
      saveText('document', text);
      saveSetting('fileName', fileName);
    }, 400);
    return () => clearTimeout(timer);
  }, [embed, text, fileName]);

  useEffect(() => {
    if (embed) return undefined;
    const timer = setTimeout(() => saveText('compareDocument', compareText), 400);
    return () => clearTimeout(timer);
  }, [embed, compareText]);

  useEffect(() => {
    if (embed) return undefined;
    const flush = () => {
      saveText('document', persistRef.current.text);
      saveSetting('fileName', persistRef.current.fileName);
      saveText('compareDocument', persistRef.current.compareText);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [embed]);

  useEffect(() => {
    if (embed) return;
    document.title = fileName ? `${fileName} — JSON Explorer` : 'JSON Explorer — Visualize, explore & compare JSON';
  }, [embed, fileName]);

  /* ─── Launch sources: shared links, ?url=, embed messages ─── */
  useEffect(() => {
    if (initialDocument.source === 'share') {
      clearShareHash();
      notify('Loaded the shared JSON.', 'info');
    } else if (initialDocument.shareError) {
      clearShareHash();
      notify(initialDocument.shareError, 'error');
    }
  }, [initialDocument, notify]);

  useEffect(() => {
    if (embed) return undefined;
    const handleHashChange = () => {
      try {
        const shared = readSharedText(window.location.hash);
        if (shared === null) return;
        loadDocument(shared);
        clearShareHash();
        notify('Loaded the shared JSON.', 'info');
      } catch (error) {
        notify(error.message, 'error');
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [embed, loadDocument, notify]);

  const loadFromUrl = useCallback(
    async (url) => {
      const content = await fetchJsonText(url);
      loadDocument(content, { fileName: fileNameFromUrl(url) });
      const result = parseJson(content);
      if (!result.ok) {
        notify(
          result.empty ? 'The URL returned an empty response.' : `Loaded, but the response is not valid JSON: ${result.error.message}. Try Repair.`,
          'warning'
        );
      }
      return content;
    },
    [loadDocument, notify]
  );

  useEffect(() => {
    if (!launch.dataUrl) return undefined;
    let cancelled = false;
    fetchJsonText(launch.dataUrl)
      .then((content) => {
        if (cancelled) return;
        const result = parseJson(content);
        loadDocument(content, { fileName: fileNameFromUrl(launch.dataUrl) });
        if (!result.ok && embed) {
          setRemote({ status: 'error', message: result.empty ? 'The URL returned an empty response.' : `Invalid JSON: ${result.error.message}` });
          return;
        }
        setRemote(null);
        if (!result.ok) {
          notify(result.empty ? 'The URL returned an empty response.' : `Loaded, but the response is not valid JSON: ${result.error.message}.`, 'warning');
        }
      })
      .catch((error) => {
        if (cancelled) return;
        if (embed) setRemote({ status: 'error', message: error.message });
        else {
          setRemote(null);
          notify(`Could not load ${launch.dataUrl}: ${error.message}`, 'error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [embed, launch.dataUrl, loadDocument, notify]);

  useEffect(() => {
    if (!embed) return undefined;
    const handleMessage = (event) => {
      const message = event.data;
      if (!message || typeof message !== 'object' || message.type !== EMBED_MESSAGE_TYPE) return;
      const { payload } = message;
      if (payload === undefined) {
        setRemote({ status: 'error', message: 'No JSON payload was provided.' });
        return;
      }
      if (typeof payload === 'string') {
        const result = parseJson(payload);
        loadDocument(payload);
        setRemote(result.ok ? null : { status: 'error', message: result.empty ? 'The JSON payload is empty.' : `Invalid JSON: ${result.error.message}` });
        return;
      }
      try {
        loadDocument(JSON.stringify(payload, null, 2));
        setRemote(null);
      } catch (error) {
        setRemote({ status: 'error', message: `Payload is not serializable as JSON: ${error.message}` });
      }
    };
    window.addEventListener('message', handleMessage);
    if (window.parent !== window) {
      window.parent.postMessage({ type: EMBED_READY_MESSAGE_TYPE }, '*');
    }
    return () => window.removeEventListener('message', handleMessage);
  }, [embed, loadDocument]);

  /* ─── Views & layout ─── */
  const [storedView, setView] = usePersistentState('view', 'graph', {
    enabled: !embed,
    validate: (candidate) => VIEW_IDS.includes(candidate),
    override: launch.view,
  });
  const view = embed && storedView === 'compare' ? 'graph' : storedView;
  const [mountedViews, setMountedViews] = useState(() => new Set([view]));
  useEffect(() => {
    setMountedViews((previous) => (previous.has(view) ? previous : new Set([...previous, view])));
  }, [view]);

  const [editorWidth, setEditorWidth] = useState(() => {
    const stored = Number(loadSetting('editorWidth', DEFAULT_EDITOR_WIDTH));
    return Number.isFinite(stored) ? Math.min(maxEditorWidth(), Math.max(MIN_EDITOR_WIDTH, stored)) : DEFAULT_EDITOR_WIDTH;
  });
  useEffect(() => {
    const timer = setTimeout(() => saveSetting('editorWidth', editorWidth), 300);
    return () => clearTimeout(timer);
  }, [editorWidth]);
  const [editorCollapsed, setEditorCollapsed] = usePersistentState('editorCollapsed', false, { enabled: !embed });
  const [mobilePane, setMobilePane] = useState('viewer');
  const showEditor = !embed && !editorCollapsed;

  const [followCursor, setFollowCursor] = usePersistentState('followCursor', true, { enabled: !embed });
  const toggleFollowCursor = useMemo(() => (embed ? undefined : () => setFollowCursor((previous) => !previous)), [embed, setFollowCursor]);

  const selectPath = useCallback((path, { openDetails = true, origin = 'viewer' } = {}) => {
    setSelection({ path, origin, key: Date.now() });
    if (openDetails) setDetailsOpen(true);
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(null);
    setDetailsOpen(false);
  }, []);

  // Drop the selection when edits remove the selected value.
  useEffect(() => {
    if (selection && hasValue && getValueAtPath(value, selection.path) === undefined) {
      setSelection(null);
      setDetailsOpen(false);
    }
  }, [hasValue, selection, value]);

  const handleCursorPath = useCallback(
    (path) => {
      if (!followCursor || !hasValue || parseResult.ok === false) return;
      setSelection((previous) => {
        if (previous && previous.path.length === path.length && previous.path.every((segment, index) => segment === path[index])) {
          return previous;
        }
        return { path, origin: 'editor', key: Date.now() };
      });
    },
    [followCursor, hasValue, parseResult.ok]
  );

  /* ─── Actions ─── */
  const editorApiRef = useRef(null);
  const viewerApiRef = useRef(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);

  const handleShare = useCallback(async () => {
    if (!text.trim()) {
      notify('Nothing to share yet — the editor is empty.', 'info');
      return;
    }
    const url = buildShareUrl(text);
    if (url.length > MAX_SHARE_URL_LENGTH) {
      notify(`This document is too large for a link (${formatBytes(url.length)} compressed). Download it and share the file instead.`, 'warning');
      return;
    }
    const copied = await copyText(url);
    notify(copied ? 'Shareable link copied to the clipboard.' : 'Could not copy the link to the clipboard.', copied ? 'success' : 'error');
  }, [notify, text]);

  const openFile = useCallback(() => {
    if (view === 'compare') setView('graph');
    if (editorCollapsed) setEditorCollapsed(false);
    setTimeout(() => editorApiRef.current?.openFile(), 0);
  }, [editorCollapsed, setEditorCollapsed, setView, view]);

  const revealInEditor = useCallback(
    (path) => {
      if (compact) setMobilePane('editor');
      if (editorCollapsed) setEditorCollapsed(false);
      setTimeout(() => {
        if (!editorApiRef.current?.revealPath(path)) notify('Could not find that value in the editor text.', 'warning');
      }, compact || editorCollapsed ? 60 : 0);
    },
    [compact, editorCollapsed, notify, setEditorCollapsed]
  );

  const changeView = useCallback(
    (next) => {
      setView(next);
      if (compact && next !== 'compare') setMobilePane('viewer');
    },
    [compact, setView]
  );

  /* ─── Drag & drop ─── */
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');

  const handleDrop = useCallback(
    async (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepth.current = 0;
      setDragActive(false);
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      try {
        const content = await readFileAsText(file);
        loadDocument(content, { fileName: file.name });
        notify(`Opened ${file.name} (${formatBytes(file.size)}).`, 'success');
      } catch (error) {
        notify(`Could not read ${file.name}: ${error.message}`, 'error');
      }
    },
    [loadDocument, notify]
  );

  const dropHandlers = embed
    ? {}
    : {
        onDragEnterCapture: (event) => {
          if (!hasFiles(event)) return;
          dragDepth.current += 1;
          setDragActive(true);
        },
        onDragLeaveCapture: (event) => {
          if (!hasFiles(event)) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragActive(false);
        },
        onDragOverCapture: (event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        },
        onDropCapture: handleDrop,
      };

  // Stop the browser from navigating away when a file is dropped outside a drop zone.
  useEffect(() => {
    const prevent = (event) => {
      if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  /* ─── Keyboard shortcuts ─── */
  useEffect(() => {
    if (embed) return undefined;
    const handleKeyDown = (event) => {
      if (event.defaultPrevented) return;
      const typing = isTypingTarget(event.target);
      const modifier = hasModifier(event);
      const key = event.key.toLowerCase();

      const viewIndex = { Digit1: 0, Digit2: 1, Digit3: 2 }[event.code];
      if (event.altKey && !modifier && !event.shiftKey && viewIndex !== undefined && (!typing || !isMac)) {
        event.preventDefault();
        changeView(VIEW_IDS[viewIndex]);
        return;
      }
      if (modifier && !event.shiftKey && key === 's') {
        event.preventDefault();
        editorApiRef.current?.download();
        return;
      }
      if (modifier && !event.shiftKey && key === 'o') {
        event.preventDefault();
        openFile();
        return;
      }
      if (typing) return;
      if (modifier && event.shiftKey && key === 'f') {
        event.preventDefault();
        editorApiRef.current?.format();
      } else if (modifier && event.shiftKey && key === 'm') {
        event.preventDefault();
        editorApiRef.current?.minify();
      } else if (event.key === '?' && !modifier) {
        event.preventDefault();
        setShortcutsOpen(true);
      } else if ((event.key === '/' && !modifier) || (modifier && key === 'f')) {
        if (view === 'compare') return;
        event.preventDefault();
        if (compact) setMobilePane('viewer');
        viewerApiRef.current?.focusSearch();
      } else if (event.key === 'Escape' && detailsOpen) {
        setDetailsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [changeView, compact, detailsOpen, embed, openFile, view]);

  /* ─── Render ─── */
  const loadFirstSample = () => loadDocument(SAMPLES[0].build(), { fileName: `${SAMPLES[0].id}.json` });
  const exploreVisible = view !== 'compare';
  const showViewerOverlay = remote && (embed || remote.status === 'loading');

  const viewerContent = (() => {
    if (!hasValue) {
      return parseResult.empty || embed ? (
        <EmptyState embed={embed} onOpenFile={openFile} onLoadSample={loadFirstSample} />
      ) : (
        <div className="je-empty">
          <div className="je-empty-card is-error">
            <WarningAmberRoundedIcon />
            <h2>Invalid JSON</h2>
            <p>{parseResult.error?.message}</p>
            <p className="je-muted">
              Line {parseResult.error?.line}, column {parseResult.error?.column}. Use Repair in the editor toolbar to fix common mistakes.
            </p>
          </div>
        </div>
      );
    }
    return null;
  })();

  return (
    <div className={`je-app${embed ? ' is-embed' : ''}`}>
      {!embed && (
        <AppHeader
          view={view}
          onViewChange={changeView}
          themeMode={themeMode}
          onToggleTheme={onToggleTheme}
          onShare={handleShare}
          onShowShortcuts={() => setShortcutsOpen(true)}
          compact={compact}
        />
      )}

      <main className="je-main">
        <div
          id="je-panel-explore"
          role={embed ? undefined : 'tabpanel'}
          aria-labelledby={embed ? undefined : `je-tab-${view === 'tree' ? 'tree' : 'graph'}`}
          className={`je-explore${compact ? ' is-compact' : ''} pane-${mobilePane}`}
          hidden={!exploreVisible}
          {...dropHandlers}
        >
          {compact && showEditor && (
            <div className="je-pane-switch" role="group" aria-label="Show editor or viewer">
              <button type="button" aria-pressed={mobilePane === 'editor'} onClick={() => setMobilePane('editor')}>
                <CodeRoundedIcon fontSize="small" /> Editor
              </button>
              <button type="button" aria-pressed={mobilePane === 'viewer'} onClick={() => setMobilePane('viewer')}>
                <SchemaRoundedIcon fontSize="small" /> {view === 'tree' ? 'Tree' : 'Graph'}
              </button>
            </div>
          )}

          {showEditor && (
            <>
              <section className="je-editor-panel" style={compact ? undefined : { width: editorWidth }} aria-label="JSON editor">
                <JsonEditor
                  apiRef={editorApiRef}
                  text={text}
                  onTextChange={setText}
                  fileName={fileName}
                  parseResult={parseResult}
                  stats={stats}
                  themeMode={themeMode}
                  enabled={remote?.status !== 'loading'}
                  onLoadDocument={loadDocument}
                  onOpenUrl={() => setUrlDialogOpen(true)}
                  onCursorPath={handleCursorPath}
                  onCollapse={compact ? undefined : () => setEditorCollapsed(true)}
                />
              </section>
              {!compact && <Resizer width={editorWidth} onResize={setEditorWidth} />}
            </>
          )}

          <section className="je-viewer" aria-label={view === 'tree' ? 'Tree view' : 'Graph view'}>
            {!embed && editorCollapsed && !compact && (
              <ToolButton
                label="Show editor"
                icon={<KeyboardDoubleArrowRightRoundedIcon fontSize="small" />}
                className="je-show-editor"
                placement="right"
                onClick={() => setEditorCollapsed(false)}
              />
            )}

            {embed && (
              <div className="je-embed-switch" role="group" aria-label="View">
                {VIEWS.filter((item) => item.id !== 'compare').map((item) => (
                  <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => setView(item.id)}>
                    {item.icon} {item.label}
                  </button>
                ))}
              </div>
            )}

            {isStale && (
              <div className="je-stale-banner" role="status">
                <WarningAmberRoundedIcon fontSize="small" />
                <span>
                  Invalid JSON at line {parseResult.error.line} — showing the last valid version.
                </span>
              </div>
            )}

            {viewerContent}

            {hasValue && (mountedViews.has('graph') || view === 'graph') && (
              <div className="je-view-host" hidden={view !== 'graph'}>
                <ErrorBoundary resetKey={lastValid}>
                  <JsonViewer
                    apiRef={view === 'graph' ? viewerApiRef : undefined}
                    value={value}
                    docVersion={docVersion}
                    active={exploreVisible && view === 'graph' && (!compact || mobilePane === 'viewer')}
                    selection={selection}
                    onSelectPath={selectPath}
                    onClearSelection={clearSelection}
                    followCursor={followCursor}
                    onToggleFollowCursor={toggleFollowCursor}
                    compact={compact}
                  />
                </ErrorBoundary>
              </div>
            )}

            {hasValue && (mountedViews.has('tree') || view === 'tree') && (
              <div className="je-view-host" hidden={view !== 'tree'}>
                <ErrorBoundary resetKey={lastValid}>
                  <Suspense fallback={<ViewLoading />}>
                    <TreeView
                      apiRef={view === 'tree' ? viewerApiRef : undefined}
                      value={value}
                      docVersion={docVersion}
                      active={exploreVisible && view === 'tree' && (!compact || mobilePane === 'viewer')}
                      selection={selection}
                      onSelectPath={selectPath}
                      onClearSelection={clearSelection}
                      followCursor={followCursor}
                      onToggleFollowCursor={toggleFollowCursor}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}

            {hasValue && detailsOpen && selection && (
              <DetailsPanel
                root={value}
                path={selection.path}
                sourceText={lastValid.text}
                onClose={() => setDetailsOpen(false)}
                onSelectPath={selectPath}
                onRevealInEditor={embed ? undefined : revealInEditor}
                compact={compact}
              />
            )}

            {showViewerOverlay && (
              <div className={`je-remote-overlay is-${remote.status}`} role={remote.status === 'error' ? 'alert' : 'status'}>
                {remote.status === 'loading' && <span className="je-spinner" aria-hidden="true" />}
                <span>{remote.message}</span>
              </div>
            )}
          </section>

          {dragActive && (
            <div className="je-drop-overlay">
              <div className="je-drop-card">
                <UploadFileRoundedIcon />
                <strong>Drop to open</strong>
                <span>JSON, GeoJSON or text files</span>
              </div>
            </div>
          )}
        </div>

        {!embed && (mountedViews.has('compare') || view === 'compare') && (
          <div id="je-panel-compare" role="tabpanel" aria-labelledby="je-tab-compare" className="je-compare-host" hidden={view !== 'compare'}>
            <Suspense fallback={<ViewLoading />}>
              <JsonCompare
                leftText={text}
                onLeftTextChange={setText}
                onLoadLeft={loadDocument}
                rightText={compareText}
                onRightTextChange={setCompareText}
                leftName={fileName}
                themeMode={themeMode}
                active={view === 'compare'}
              />
            </Suspense>
          </div>
        )}
      </main>

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <UrlDialog open={urlDialogOpen} onClose={() => setUrlDialogOpen(false)} onSubmit={loadFromUrl} />
    </div>
  );
}
