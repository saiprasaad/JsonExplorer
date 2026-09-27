import { useTheme } from '@mui/material/styles';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, MiniMap, ReactFlowProvider, getViewportForBounds, useReactFlow, useStore } from 'reactflow';
import 'reactflow/dist/style.css';
import { usePersistentState } from '../hooks/usePersistentState';
import { PALETTES } from '../theme';
import { downloadBlob } from '../utils/files';
import {
  buildFlowGraph,
  buildGraphModel,
  extendChildWindow,
  findNodeForPath,
  getLineage,
  getNeighborNode,
  getNodePath,
  revealNode,
  searchModel,
} from '../utils/graph';
import { formatPath, getValueAtPath, previewValue } from '../utils/json';
import { nodeTypes } from './graph/GraphNodes';
import { GraphToolbar } from './graph/GraphToolbar';
import { WalkthroughBar } from './graph/WalkthroughBar';
import { useNotify } from './Notifier';
import { SearchBox } from './SearchBox';

export const WALKTHROUGH_STEP_MS = 1800;
const SEARCH_LIMIT = 5000;
const MIN_FIT_ZOOM = 0.35;
const FOCUS_ZOOM = 0.75;
const MAX_EXPORT_SIZE = 8000;

const paneWidthSelector = (state) => state.width;
const paneHeightSelector = (state) => state.height;
const invalidTransformSelector = (state) => !state.transform.every(Number.isFinite);

function boundsOf(nodes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach(({ position, style }) => {
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x + style.width);
    maxY = Math.max(maxY, position.y + style.height);
  });
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function GraphCanvas({
  apiRef,
  value: latestValue,
  docVersion,
  active,
  selection,
  onSelectPath,
  onClearSelection,
  detailsOpen,
  followCursor,
  onToggleFollowCursor,
  compact,
}) {
  const notify = useNotify();
  const mode = useTheme().palette.mode;
  const palette = PALETTES[mode];
  const { setViewport, getViewport, zoomIn, zoomOut } = useReactFlow();
  const paneWidth = useStore(paneWidthSelector);
  const paneHeight = useStore(paneHeightSelector);
  const containerRef = useRef(null);
  const searchApiRef = useRef(null);

  const [direction, setDirection] = usePersistentState('graphDirection', 'LR', { validate: (candidate) => candidate === 'LR' || candidate === 'TB' });
  const [showMinimap, setShowMinimap] = usePersistentState('graphMinimap', false);
  const [speed, setSpeed] = usePersistentState('walkthroughSpeed', 1, { validate: (candidate) => [0.5, 1, 2, 4].includes(candidate) });
  const [expansion, setExpansion] = useState(() => new Map());
  const [expandMode, setExpandMode] = useState('auto');
  const [childWindows, setChildWindows] = useState(() => new Map());
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [playback, setPlayback] = useState({ index: -1, playing: false });
  const [pendingFocus, setPendingFocus] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [ready, setReady] = useState(false);
  const pendingFitRef = useRef(true);
  const anchorRef = useRef(null);

  // While hidden, keep the last shown value so edits don't rebuild a large graph; catch up when shown.
  const [value, setShownValue] = useState(latestValue);
  if (active && value !== latestValue) setShownValue(latestValue);

  // Reset per-document state when a new document is loaded (deferred, like the value, while hidden).
  const [trackedVersion, setTrackedVersion] = useState(docVersion);
  if (active && trackedVersion !== docVersion) {
    setTrackedVersion(docVersion);
    setExpansion(new Map());
    setExpandMode('auto');
    setChildWindows(new Map());
    setPlayback({ index: -1, playing: false });
    setPendingFocus(null);
    pendingFitRef.current = true;
  }

  const model = useMemo(() => buildGraphModel(value), [value]);
  const graph = useMemo(
    () => buildFlowGraph(model, { expansion, mode: expandMode, windows: childWindows, direction }),
    [model, expansion, expandMode, childWindows, direction]
  );
  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph]);

  /* ─── Viewport helpers ─── */
  // d3-zoom's animated transitions divide by the canvas size, so never animate while hidden.
  const isVisible = useCallback(() => {
    const container = containerRef.current;
    return Boolean(container && container.clientWidth > 0 && container.clientHeight > 0);
  }, []);

  // Self-heal if the viewport ever becomes non-finite (it would blank the canvas).
  const invalidTransform = useStore(invalidTransformSelector);
  useEffect(() => {
    if (!invalidTransform) return;
    setViewport({ x: 0, y: 0, zoom: 1 });
    pendingFitRef.current = true;
  }, [invalidTransform, setViewport]);

  /** The part of the canvas not covered by the details panel, in canvas pixels. */
  const getSafeArea = useCallback(() => {
    const container = containerRef.current;
    const area = { left: 0, top: 0, right: container?.clientWidth || paneWidth, bottom: container?.clientHeight || paneHeight };
    const panel = container?.closest('.je-viewer')?.querySelector('.je-details');
    if (!container || !panel) return area;
    // offset* ignore the panel's slide-in transform; both share the viewer's top-left origin.
    if (panel.offsetWidth >= area.right * 0.9) area.bottom = Math.max(area.top + 120, panel.offsetTop);
    else area.right = Math.max(area.left + 160, panel.offsetLeft);
    return area;
  }, [paneHeight, paneWidth]);

  const centerOn = useCallback(
    (nodeId, { duration = 450, minZoom = FOCUS_ZOOM } = {}) => {
      const node = nodeById.get(nodeId);
      if (!node || !isVisible()) return false;
      const zoom = Math.max(getViewport().zoom, minZoom);
      const area = getSafeArea();
      const centerX = node.position.x + node.style.width / 2;
      const centerY = node.position.y + node.style.height / 2;
      setViewport(
        { x: (area.left + area.right) / 2 - centerX * zoom, y: (area.top + area.bottom) / 2 - centerY * zoom, zoom },
        { duration }
      );
      return true;
    },
    [getSafeArea, getViewport, isVisible, nodeById, setViewport]
  );

  const fitAll = useCallback(
    ({ duration = 350, readable = false } = {}) => {
      if (!paneWidth || !paneHeight || graph.nodes.length === 0 || !isVisible()) {
        pendingFitRef.current = true;
        return;
      }
      const viewport = getViewportForBounds(boundsOf(graph.nodes), paneWidth, paneHeight, 0.05, 1.1, 0.08);
      const root = nodeById.get(model.rootId);
      if (!readable || viewport.zoom >= MIN_FIT_ZOOM || !root) {
        setViewport(viewport, { duration });
        return;
      }
      // The whole graph would be unreadably small: start at the root instead.
      const zoom = 0.8;
      const { x, y } = root.position;
      const { width, height } = root.style;
      setViewport(
        direction === 'LR'
          ? { x: 48 - x * zoom, y: paneHeight / 2 - (y + height / 2) * zoom, zoom }
          : { x: paneWidth / 2 - (x + width / 2) * zoom, y: 48 - y * zoom, zoom },
        { duration }
      );
    },
    [direction, graph.nodes, isVisible, model.rootId, nodeById, paneHeight, paneWidth, setViewport]
  );

  useEffect(() => {
    if (!pendingFitRef.current || !active || !paneWidth || !paneHeight) return;
    pendingFitRef.current = false;
    fitAll({ duration: ready ? 300 : 0, readable: true });
    if (!ready) requestAnimationFrame(() => setReady(true));
  }, [active, fitAll, paneHeight, paneWidth, ready]);

  // The canvas is positioned by transforms only. Browsers can still scroll its overflow-hidden
  // containers (e.g. when revealing a focused or found element), which would desynchronise the
  // viewport from what is drawn, so undo any such scroll immediately.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const resetScroll = (event) => {
      const target = event.target;
      if (target instanceof Element && container.contains(target) && (target.scrollLeft || target.scrollTop)) {
        target.scrollLeft = 0;
        target.scrollTop = 0;
      }
    };
    container.addEventListener('scroll', resetScroll, true);
    return () => container.removeEventListener('scroll', resetScroll, true);
  }, []);

  // Keep the node the user interacted with at the same spot on screen while the layout shifts.
  const anchorOn = useCallback(
    (nodeId) => {
      const node = nodeById.get(nodeId);
      if (node) anchorRef.current = { id: nodeId, x: node.position.x, y: node.position.y };
    },
    [nodeById]
  );

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    const node = nodeById.get(anchor.id);
    if (!node || !isVisible()) return;
    const dx = node.position.x - anchor.x;
    const dy = node.position.y - anchor.y;
    if (dx === 0 && dy === 0) return;
    const viewport = getViewport();
    setViewport({ x: viewport.x - dx * viewport.zoom, y: viewport.y - dy * viewport.zoom, zoom: viewport.zoom });
  }, [getViewport, isVisible, nodeById, setViewport]);

  /** Makes a node visible (expanding ancestors / paging) and then centres it. */
  const focusNode = useCallback(
    (nodeId) => {
      if (!model.nodes.has(nodeId)) return;
      if (!nodeById.has(nodeId)) {
        const next = revealNode(model, nodeId, expansion, childWindows);
        setExpansion(next.expansion);
        setChildWindows(next.windows);
      }
      setPendingFocus({ id: nodeId, key: Date.now() });
    },
    [childWindows, expansion, model, nodeById]
  );

  useEffect(() => {
    if (!pendingFocus || !active) return;
    if (!model.nodes.has(pendingFocus.id)) {
      setPendingFocus(null);
      return;
    }
    if (centerOn(pendingFocus.id)) setPendingFocus(null);
  }, [active, centerOn, model, pendingFocus]);

  /* ─── Selection ─── */
  const target = useMemo(() => (selection ? findNodeForPath(model, selection.path) : null), [model, selection]);
  const selectedNodeId = target?.nodeId ?? null;
  const handledSelectionRef = useRef(null);

  useEffect(() => {
    if (!selection || !active || handledSelectionRef.current === selection.key) return;
    handledSelectionRef.current = selection.key;
    if (selection.origin !== 'graph' && target) focusNode(target.nodeId);
  }, [active, focusNode, selection, target]);

  // A clicked node does not re-centre the graph, but it must not end up hidden behind the
  // details panel that the click opened (side panel on desktop, bottom sheet on phones).
  // This happens once per click: later layout changes must not pull the view back to it.
  const keptClearRef = useRef(null);
  useEffect(() => {
    if (!detailsOpen || !selectedNodeId || !active || selection?.origin !== 'graph') return undefined;
    if (keptClearRef.current === selection.key) return undefined;
    const frame = requestAnimationFrame(() => {
      const node = nodeById.get(selectedNodeId);
      if (!node || !isVisible()) return;
      keptClearRef.current = selection.key;
      const area = getSafeArea();
      const viewport = getViewport();
      const margin = 16;
      // Shift along one axis so [start, end] fits inside [min, max]; if it cannot fit, align the start.
      const shift = (start, end, min, max) => {
        if (end - start > max - min - 2 * margin) return min + margin - start;
        if (end > max - margin) return max - margin - end;
        if (start < min + margin) return min + margin - start;
        return 0;
      };
      const left = viewport.x + node.position.x * viewport.zoom;
      const top = viewport.y + node.position.y * viewport.zoom;
      const dx = shift(left, left + node.style.width * viewport.zoom, area.left, area.right);
      const dy = shift(top, top + node.style.height * viewport.zoom, area.top, area.bottom);
      if (dx || dy) setViewport({ x: viewport.x + dx, y: viewport.y + dy, zoom: viewport.zoom }, { duration: 300 });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, detailsOpen, getSafeArea, getViewport, isVisible, nodeById, selectedNodeId, selection, setViewport]);

  /* ─── Search ─── */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 150);
    return () => clearTimeout(timer);
  }, [query]);

  const matches = useMemo(() => searchModel(model, debouncedQuery, SEARCH_LIMIT), [model, debouncedQuery]);
  const safeMatchIndex = matches.length ? Math.min(matchIndex, matches.length - 1) : 0;
  const revealedQueryRef = useRef('');

  useEffect(() => {
    if (debouncedQuery === revealedQueryRef.current) return;
    revealedQueryRef.current = debouncedQuery;
    setMatchIndex(0);
    if (matches.length > 0) focusNode(matches[0]);
  }, [debouncedQuery, focusNode, matches]);

  const goToMatch = useCallback(
    (step) => {
      if (matches.length === 0) return;
      const next = (safeMatchIndex + step + matches.length) % matches.length;
      setMatchIndex(next);
      focusNode(matches[next]);
    },
    [focusNode, matches, safeMatchIndex]
  );

  /* ─── Walkthrough ─── */
  const sequence = graph.order;
  const stopPlayback = useCallback(() => setPlayback((current) => (current.index === -1 && !current.playing ? current : { index: -1, playing: false })), []);

  useEffect(() => {
    if (!playback.playing) return undefined;
    if (playback.index >= sequence.length - 1) {
      setPlayback((current) => ({ ...current, playing: false }));
      return undefined;
    }
    const timer = setTimeout(() => setPlayback((current) => ({ ...current, index: current.index + 1 })), WALKTHROUGH_STEP_MS / speed);
    return () => clearTimeout(timer);
  }, [playback, sequence.length, speed]);

  const playbackNodeId = playback.index >= 0 ? sequence[playback.index] ?? null : null;

  // Centre each step once, when the step changes — not when the graph merely re-renders.
  const centeredStepRef = useRef(-1);
  useEffect(() => {
    if (playback.index < 0) {
      centeredStepRef.current = -1;
      return;
    }
    if (!playbackNodeId || !active || centeredStepRef.current === playback.index) return;
    if (centerOn(playbackNodeId, { duration: Math.min(650, WALKTHROUGH_STEP_MS / speed / 2), minZoom: 0.85 })) {
      centeredStepRef.current = playback.index;
    }
  }, [active, centerOn, playback.index, playbackNodeId, speed]);

  useEffect(() => {
    if (!active) setPlayback((current) => (current.playing ? { ...current, playing: false } : current));
  }, [active]);

  const handlePlayPause = useCallback(() => {
    setPlayback((current) => {
      if (current.playing) return { ...current, playing: false };
      const atEnd = current.index < 0 || current.index >= sequence.length - 1;
      return { index: atEnd ? 0 : current.index, playing: true };
    });
  }, [sequence.length]);

  const playbackLabel = useMemo(() => {
    if (!playbackNodeId) return '';
    return formatPath(getNodePath(model, playbackNodeId));
  }, [model, playbackNodeId]);

  /* ─── Expansion ─── */
  const toggleNode = useCallback(
    (nodeId) => {
      anchorOn(nodeId);
      const collapsed = graph.collapsedIds.has(nodeId);
      setExpansion((previous) => new Map(previous).set(nodeId, collapsed));
    },
    [anchorOn, graph.collapsedIds]
  );

  const expandNoticeRef = useRef(false);
  const expandAll = useCallback(() => {
    setExpansion(new Map());
    setExpandMode('expanded');
    expandNoticeRef.current = true;
    pendingFitRef.current = true;
  }, []);

  const collapseAll = useCallback(() => {
    setExpansion(new Map());
    setExpandMode('collapsed');
    setChildWindows(new Map());
    stopPlayback();
    pendingFitRef.current = true;
  }, [stopPlayback]);

  useEffect(() => {
    if (!expandNoticeRef.current || expandMode !== 'expanded') return;
    expandNoticeRef.current = false;
    if (graph.collapsedIds.size > 0) {
      notify(
        `Expanded ${graph.order.length.toLocaleString('en-US')} of ${model.nodes.size.toLocaleString('en-US')} nodes — the rest stay collapsed to keep things fast.`,
        'info'
      );
    }
  }, [expandMode, graph, model.nodes.size, notify]);

  const toggleDirection = useCallback(() => {
    setDirection((current) => (current === 'LR' ? 'TB' : 'LR'));
    pendingFitRef.current = true;
  }, [setDirection]);

  /* ─── Pointer & keyboard ─── */
  const handleNodeClick = useCallback(
    (event, node) => {
      stopPlayback();
      if (node.type === 'more') {
        const all = event.target.closest('[data-more]')?.dataset.more === 'all';
        // Keep the sibling beside the stub in place, so new siblings appear where the user clicked.
        anchorOn(node.data.anchorId);
        setChildWindows((previous) => extendChildWindow(previous, node.data, all));
        return;
      }
      if (event.target.closest('[data-toggle]')) {
        toggleNode(node.id);
        return;
      }
      const path = getNodePath(model, node.id);
      const rowIndex = Number(event.target.closest('[data-row-index]')?.dataset.rowIndex);
      const row = Number.isInteger(rowIndex) && rowIndex >= 0 ? node.data.view.rows[rowIndex] : null;
      onSelectPath(row ? [...path, row.key] : path, { origin: 'graph' });
      containerRef.current?.focus({ preventScroll: true });
    },
    [anchorOn, model, onSelectPath, stopPlayback, toggleNode]
  );

  const handleNodeDoubleClick = useCallback(
    (event, node) => {
      if (node.type === 'json' && node.data.childCount > 0 && !event.target.closest('[data-toggle]')) toggleNode(node.id);
    },
    [toggleNode]
  );

  const handlePaneClick = useCallback(() => {
    stopPlayback();
    onClearSelection();
  }, [onClearSelection, stopPlayback]);

  const handleKeyDown = (event) => {
    // Only keys pressed on the canvas itself: toolbar buttons, the search box and menus handle their own.
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
    const moves =
      direction === 'LR'
        ? { ArrowLeft: 'parent', ArrowRight: 'child', ArrowUp: 'prev', ArrowDown: 'next' }
        : { ArrowUp: 'parent', ArrowDown: 'child', ArrowLeft: 'prev', ArrowRight: 'next' };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      if (!selectedNodeId || !nodeById.has(selectedNodeId)) {
        onSelectPath([], { openDetails: false, origin: 'keyboard' });
        return;
      }
      const next = getNeighborNode(graph, selectedNodeId, move);
      if (next) onSelectPath(getNodePath(model, next), { openDetails: false, origin: 'keyboard' });
      else if (move === 'child' && graph.collapsedIds.has(selectedNodeId)) toggleNode(selectedNodeId);
      return;
    }
    if ((event.key === ' ' || event.key === 'Enter') && selectedNodeId && model.nodes.get(selectedNodeId)?.childIds.length) {
      event.preventDefault();
      toggleNode(selectedNodeId);
    } else if (event.key === 'Escape') {
      stopPlayback();
      onClearSelection();
    } else if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      fitAll();
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomIn({ duration: 150 });
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomOut({ duration: 150 });
    }
  };

  useImperativeHandle(apiRef, () => ({ focusSearch: () => searchApiRef.current?.focus(), fitView: () => fitAll() }), [fitAll]);

  /* ─── Export ─── */
  const handleExport = useCallback(
    async (format) => {
      setExporting(true);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      try {
        const { toBlob, toSvg } = await import('html-to-image');
        const element = containerRef.current?.querySelector('.react-flow__viewport');
        const bounds = boundsOf(graph.nodes);
        const padding = 40;
        const scale = Math.min(1, MAX_EXPORT_SIZE / Math.max(bounds.width, bounds.height));
        const width = Math.ceil(bounds.width * scale + padding * 2);
        const height = Math.ceil(bounds.height * scale + padding * 2);
        const options = {
          backgroundColor: palette.bg,
          // The app only uses system fonts; skipping font embedding also avoids reading cross-origin stylesheets.
          skipFonts: true,
          width,
          height,
          pixelRatio: Math.max(width, height) <= 3000 ? 2 : 1,
          style: {
            width: `${width}px`,
            height: `${height}px`,
            transform: `translate(${padding - bounds.x * scale}px, ${padding - bounds.y * scale}px) scale(${scale})`,
          },
        };
        if (format === 'svg') {
          const dataUrl = await toSvg(element, options);
          const svg = decodeURIComponent(dataUrl.slice(dataUrl.indexOf(',') + 1));
          downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'json-graph.svg');
        } else {
          const blob = await toBlob(element, options);
          if (format === 'clipboard') {
            await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
            notify('Graph image copied to the clipboard.', 'success');
          } else {
            downloadBlob(blob, 'json-graph.png');
          }
        }
      } catch (error) {
        notify(`Export failed: ${error.message || 'the browser blocked the operation.'}`, 'error');
      } finally {
        setExporting(false);
      }
    },
    [graph.nodes, notify, palette.bg]
  );

  /* ─── Decorations ─── */
  const lineage = useMemo(() => {
    const focusId = playbackNodeId ?? selectedNodeId;
    return focusId && nodeById.has(focusId) ? getLineage(graph.parentOf, focusId) : { nodeIds: [], edgeIds: [] };
  }, [graph.parentOf, nodeById, playbackNodeId, selectedNodeId]);

  const decoratedNodes = useMemo(() => {
    const matchSet = new Set(matches);
    const currentMatch = matches[safeMatchIndex];
    const lineageSet = new Set(lineage.nodeIds);
    const visited = playback.index >= 0 ? new Set(sequence.slice(0, playback.index)) : null;
    const selectedRow = target?.rowKey ?? undefined;

    return graph.nodes.map((node) => {
      const classes = [];
      if (node.id === selectedNodeId) classes.push('je-selected');
      else if (lineageSet.has(node.id)) classes.push('je-lineage');
      if (matchSet.has(node.id)) classes.push(node.id === currentMatch ? 'je-match-current' : 'je-match');
      if (node.id === playbackNodeId) classes.push('je-playing');
      else if (visited?.has(node.id)) classes.push('je-visited');

      const withQuery = debouncedQuery && matchSet.has(node.id);
      const withRow = node.id === selectedNodeId && selectedRow !== undefined;
      if (classes.length === 0 && !withQuery && !withRow) return node;
      return {
        ...node,
        className: classes.join(' '),
        data: withQuery || withRow ? { ...node.data, query: withQuery ? debouncedQuery : undefined, selectedRow: withRow ? selectedRow : undefined } : node.data,
      };
    });
  }, [debouncedQuery, graph.nodes, lineage.nodeIds, matches, playback.index, playbackNodeId, safeMatchIndex, selectedNodeId, sequence, target]);

  const decoratedEdges = useMemo(() => {
    if (lineage.edgeIds.length === 0) return graph.edges;
    const activeEdges = new Set(lineage.edgeIds);
    return graph.edges.map((edge) => (activeEdges.has(edge.id) ? { ...edge, className: 'je-edge je-edge--active', animated: true } : edge));
  }, [graph.edges, lineage.edgeIds]);

  const hiddenCount = model.nodes.size - graph.order.length;

  // Screen readers hear what a click or arrow key selected on the canvas.
  const announcement = useMemo(() => {
    if (!selection || (selection.origin !== 'graph' && selection.origin !== 'keyboard')) return '';
    const selected = getValueAtPath(value, selection.path);
    return selected === undefined ? '' : `${formatPath(selection.path)}: ${previewValue(selected, 80)}`;
  }, [selection, value]);

  return (
    <div
      ref={containerRef}
      className={`je-graph${ready ? ' is-ready' : ''}${showMinimap && !compact ? ' has-minimap' : ''}`}
      tabIndex={0}
      role="application"
      aria-roledescription="graph"
      onKeyDown={handleKeyDown}
      aria-label="JSON graph. Use arrow keys to move between nodes, Space to expand or collapse, and Escape to clear the selection."
    >
      <div className="je-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>
      <ReactFlow
        nodes={decoratedNodes}
        edges={decoratedEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={handlePaneClick}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        panOnScroll
        minZoom={0.05}
        maxZoom={2.5}
        onlyRenderVisibleElements={!exporting && graph.nodes.length > 300}
      >
        <Background variant="dots" gap={18} size={1.2} />
        {showMinimap && !compact && (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeColor={(node) =>
              node.className?.includes('je-selected')
                ? palette.accent
                : node.className?.includes('je-match')
                  ? palette.warning
                  : palette.surface3
            }
            nodeStrokeWidth={0}
            nodeBorderRadius={4}
            maskColor={mode === 'dark' ? 'rgba(4, 10, 16, 0.62)' : 'rgba(226, 233, 238, 0.7)'}
            style={{ background: palette.surface }}
          />
        )}
      </ReactFlow>

      <GraphToolbar
        direction={direction}
        onToggleDirection={toggleDirection}
        onZoomIn={() => zoomIn({ duration: 150 })}
        onZoomOut={() => zoomOut({ duration: 150 })}
        onFit={() => fitAll()}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        showMinimap={showMinimap}
        onToggleMinimap={() => setShowMinimap((current) => !current)}
        followCursor={followCursor}
        onToggleFollowCursor={onToggleFollowCursor}
        onExport={handleExport}
        compact={compact}
      />

      <SearchBox
        apiRef={searchApiRef}
        className="je-graph-search"
        value={query}
        onChange={setQuery}
        count={matches.length}
        index={safeMatchIndex}
        limit={SEARCH_LIMIT}
        onNext={() => goToMatch(1)}
        onPrevious={() => goToMatch(-1)}
      />

      <WalkthroughBar
        isPlaying={playback.playing}
        index={playback.index}
        total={sequence.length}
        label={playbackLabel}
        speed={speed}
        onPlayPause={handlePlayPause}
        onPrevious={() => setPlayback((current) => ({ index: Math.max(0, current.index - 1), playing: false }))}
        onNext={() => setPlayback((current) => ({ index: Math.min(sequence.length - 1, current.index + 1), playing: false }))}
        onRestart={() => setPlayback({ index: 0, playing: true })}
        onSpeedChange={setSpeed}
        compact={compact}
      />

      {hiddenCount > 0 && (
        <div className="je-graph-info" role="status">
          Showing {graph.order.length.toLocaleString('en-US')} of {model.nodes.size.toLocaleString('en-US')} nodes · click{' '}
          <strong>+N</strong> to expand
        </div>
      )}
    </div>
  );
}

export function JsonViewer(props) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
