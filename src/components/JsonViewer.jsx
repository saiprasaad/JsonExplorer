import { Box, Divider, Typography, CircularProgress, Button, IconButton } from '@mui/material';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReplayIcon from '@mui/icons-material/Replay';
import SearchIcon from '@mui/icons-material/Search';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import CloseIcon from '@mui/icons-material/Close';
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import ReactFlow, { Background, Controls, Handle, Position, useReactFlow, ReactFlowProvider } from 'reactflow';
import 'reactflow/dist/style.css';

const DEFAULT_MAX_NODES = 200;
const LOAD_MORE_INCREMENT = 100;
export const WALKTHROUGH_STEP_MS = 1800;

const nodeDefaults = {
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
};

export function isPrimitiveValue(value) {
  return value === null || typeof value !== 'object';
}

export function isInlineArrayValue(value) {
  return Array.isArray(value) && value.every((item) => isPrimitiveValue(item));
}

export function shouldRenderInlineValue(value) {
  return isPrimitiveValue(value) || isInlineArrayValue(value);
}

export function formatInlineValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatInlineValue(item)).join(', ')}]`;
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return String(value);
}

export function formatNodeLabel(label, isRoot) {
  if (isRoot) {
    return label;
  }
  if (typeof label !== 'string' || /_item\d+$/.test(label)) {
    return '';
  }
  return label.replace(/^\d+\|/, '');
}

export function buildPlaybackSequence(nodes, edges) {
  if (!nodes.length) {
    return [];
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const childrenMap = new Map();
  const incomingEdgeCount = new Map(nodes.map((node) => [node.id, 0]));

  edges.forEach((edge) => {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      return;
    }

    incomingEdgeCount.set(edge.target, (incomingEdgeCount.get(edge.target) ?? 0) + 1);
    const childIds = childrenMap.get(edge.source) ?? [];
    childIds.push(edge.target);
    childrenMap.set(edge.source, childIds);
  });

  const compareNodeIds = (leftId, rightId) => {
    const left = nodeMap.get(leftId);
    const right = nodeMap.get(rightId);

    if (!left || !right) {
      return String(leftId).localeCompare(String(rightId));
    }

    return (
      (left.position?.y ?? 0) - (right.position?.y ?? 0) ||
      (left.position?.x ?? 0) - (right.position?.x ?? 0) ||
      left.id.localeCompare(right.id)
    );
  };

  childrenMap.forEach((childIds) => childIds.sort(compareNodeIds));

  const rootIds = nodes
    .map((node) => node.id)
    .filter((nodeId) => (incomingEdgeCount.get(nodeId) ?? 0) === 0)
    .sort((leftId, rightId) => {
      if (leftId === 'ROOT') return -1;
      if (rightId === 'ROOT') return 1;
      return compareNodeIds(leftId, rightId);
    });

  const visited = new Set();
  const sequence = [];

  const visit = (nodeId) => {
    if (visited.has(nodeId) || !nodeMap.has(nodeId)) {
      return;
    }

    visited.add(nodeId);
    sequence.push(nodeId);
    (childrenMap.get(nodeId) ?? []).forEach(visit);
  };

  rootIds.forEach(visit);
  nodes
    .map((node) => node.id)
    .sort(compareNodeIds)
    .forEach(visit);

  return sequence;
}

function collectNodeLineage(nodeId, edges) {
  if (!nodeId) {
    return { nodeIds: [], edgeIds: [] };
  }

  const edgeByTarget = new Map(edges.map((edge) => [edge.target, edge]));
  const nodeIds = [];
  const edgeIds = [];
  const seenNodeIds = new Set();
  let currentNodeId = nodeId;

  while (currentNodeId && !seenNodeIds.has(currentNodeId)) {
    nodeIds.push(currentNodeId);
    seenNodeIds.add(currentNodeId);

    const parentEdge = edgeByTarget.get(currentNodeId);
    if (!parentEdge) {
      break;
    }

    edgeIds.unshift(parentEdge.id);
    currentNodeId = parentEdge.source;
  }

  return { nodeIds, edgeIds };
}

const JsonNode = ({ data, isConnectable }) => {
  const { label, value, isRoot } = data;
  const getValueStyle = (val) => {
    if (typeof val === 'boolean') return { color: val ? '#00FF7F' : '#FF5C8D' };
    if (Number.isInteger(val)) return { color: 'yellow' };
    if (typeof val === 'string') return { color: 'white' };
    return { color: 'white' };
  };

  const renderInlineValue = (val) => (
    <span style={Array.isArray(val) ? { color: 'white' } : getValueStyle(val)}>
      {formatInlineValue(val)}
    </span>
  );

  const renderObjectValues = (obj) => {
    const entries = Object.entries(obj).filter(([, val]) => shouldRenderInlineValue(val));
    return entries.map(([key, val], index) => (
      <React.Fragment key={key}>
        <Typography
          variant="caption"
          sx={{
            fontSize: '11px',
            fontFamily: 'monospace',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            display: 'block',
            pointerEvents: 'auto',
            zIndex: 1,
            fontWeight: 'bold',
            color: 'white', 
            maxWidth: '100%',
          }}
          title={`${key}: ${formatInlineValue(val)}`}
        >
          <span style={{ color: "#58A6FF", fontWeight: 'bold' }}>{key}:</span>
          {renderInlineValue(val)}
        </Typography>
        {index < entries.length - 1 && (
          <Divider sx={{ my: 0.5, borderColor: '#ccc' }} />
        )}
      </React.Fragment>
    ));
  };

  return (
    <Box
      sx={{
        position: 'relative',
        padding: '8px 12px',
        fontSize: '12px',
        minWidth: 120,
        maxWidth: 260,
        border: '1px solid #ccc',
        borderRadius: '6px',
        background: 'rgba(47, 47, 47, 1)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        pointerEvents: 'none',
        fontFamily: 'monospace',
        overflow: 'hidden',
      }}
    >
      <Handle type="target" position="left" isConnectable={isConnectable} style={{ top: '50%', background: '#555' }} />
      <Handle type="source" position="right" isConnectable={isConnectable} style={{ top: '50%', background: '#555' }} />
      {isPrimitiveValue(value) ? (
        <Typography
          variant="caption"
          sx={{
            fontSize: isRoot ? '20px' : '11px',
            fontFamily: 'monospace',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            display: 'block',
            fontWeight: 'bold',
            maxWidth: '100%'
          }}
          title={String(value)}
        >
          <span style={getValueStyle(value)}>{String(value)}</span>
        </Typography>
      ) : isInlineArrayValue(value) ? (
        <>
          <Typography
            variant="caption"
            sx={{
              fontSize: '16px',
              mb: 0.5,
              fontFamily: 'monospace',
              color: '#58A6FF',
              fontWeight: 'bold',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
              display: 'block'
            }}
            title={label}
          >
            {formatNodeLabel(label, isRoot)}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              fontSize: '11px',
              fontFamily: 'monospace',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              display: 'block',
              fontWeight: 'bold',
              color: 'white',
              maxWidth: '100%',
            }}
            title={formatInlineValue(value)}
          >
            {renderInlineValue(value)}
          </Typography>
        </>
      ) : (
        <>
          <Typography
            variant="caption"
            sx={{
              fontSize: '16px',
              mb: 0.5,
              fontFamily: 'monospace',
              color: '#58A6FF',
              fontWeight: 'bold',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
              display: 'block'
            }}
            title={label}
          >
            {formatNodeLabel(label, isRoot)}
          </Typography>
          <Box sx={{ maxWidth: '100%' }}>
            {value && renderObjectValues(value)}
          </Box>
        </>
      )}
    </Box>
  );
};

const nodeTypes = { customNode: JsonNode };

/**
 * Normalizes input JSON to always be a plain object for the parser.
 * Root-level arrays are wrapped as { "Array (N items)": [...] }.
 */
function normalizeInput(json) {
  if (Array.isArray(json)) {
    return { [`Array (${json.length} items)`]: json };
  }
  if (!json || typeof json !== 'object') {
    return {};
  }
  return json;
}

export function parseJSONToFlowFixed(
  json,
  parentId = '',
  parentPath = '',
  nodes = [],
  edges = [],
  depth = 0,
  positionTracker = { y: 180 },
  nodeCounter = { count: 0 },
  maxNodes = DEFAULT_MAX_NODES
) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { nodes, edges, nextY: positionTracker.y, truncated: false, totalAvailable: 0 };
  }

  const estimateNodeHeight = (value) => {
    if (isPrimitiveValue(value) || isInlineArrayValue(value)) return 60;
    if (Array.isArray(value)) return 80 + Math.min(value.length, 5) * 30;
    const visibleEntries = Object.values(value).filter(
      v => shouldRenderInlineValue(v)
    );
    return 80 + visibleEntries.length * 26;
  };

  const nodeSpacingX = 320;
  const currentX = depth * nodeSpacingX;
  let truncated = false;

  if (
    depth === 0 &&
    !nodes.some((n) => n.id === 'ROOT') &&
    Object.keys(json).length > 1
  ) {
    const rootY = positionTracker.y;
    nodes.push({
      id: 'ROOT',
      data: { label: '', value: json, isRoot: true },
      position: { x: currentX, y: rootY },
      ...nodeDefaults,
      type: 'customNode',
    });
    nodeCounter.count++;
    positionTracker.y += 60;
  }

  for (const [key, value] of Object.entries(json)) {
    if (nodeCounter.count >= maxNodes) {
      truncated = true;
      break;
    }

    const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
    const isArrayOfInlineValues = isInlineArrayValue(value);
    const isArrayOfObjects = Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'object' && v !== null);
    const parentCanRenderInlineValues = depth > 0 || nodes.some((node) => node.id === 'ROOT');
    const shouldInlineArrayInParent = isArrayOfInlineValues && parentCanRenderInlineValues;
    const isArrayOfPrimitives = isArrayOfInlineValues && !shouldInlineArrayInParent;
    if (!isObject && !isArrayOfObjects && !isArrayOfPrimitives) continue;

    const nodeId = `${parentPath ? `${parentPath}_` : ''}${key}`;
    const isFirstChildOfRoot = depth === 1 && Object.keys(json)[0] === key;
    const yForThisNode = positionTracker.y + (isFirstChildOfRoot ? 30 : 0);
    const heightEstimate = estimateNodeHeight(value);

    if (!isArrayOfObjects) {
      positionTracker.y += heightEstimate;
      if (isFirstChildOfRoot) positionTracker.y += 30;
    }

    nodes.push({
      id: nodeId,
      data: { label: key, value, isRoot: false },
      position: { x: currentX + nodeSpacingX, y: yForThisNode },
      ...nodeDefaults,
      type: 'customNode',
    });
    nodeCounter.count++;

    edges.push({
      id: `${depth === 0 ? 'ROOT' : parentId}-${nodeId}`,
      source: depth === 0 ? 'ROOT' : parentId,
      target: nodeId,
      sourcePosition: 'right',
      targetPosition: 'left',
      type: 'default',
    });

    if (isObject) {
      const result = parseJSONToFlowFixed(value, nodeId, nodeId, nodes, edges, depth + 1, positionTracker, nodeCounter, maxNodes);
      if (result.truncated) truncated = true;
    }

    if (isArrayOfObjects) {
      let itemY = yForThisNode;
      if (depth === 1 && Object.keys(json)[0] === key) itemY += 30;
      for (let i = 0; i < value.length; i++) {
        if (nodeCounter.count >= maxNodes) {
          truncated = true;
          break;
        }
        const item = value[i];
        const leafId = `${nodeId}_item${i}`;
        const itemX = currentX + 2 * nodeSpacingX;

        nodes.push({
          id: leafId,
          data: { label: item.id || item.name || `[${i}]`, value: item, isRoot: false },
          position: { x: itemX, y: itemY },
          ...nodeDefaults,
          type: 'customNode',
        });
        nodeCounter.count++;

        edges.push({
          id: `${nodeId}-${leafId}`,
          source: nodeId,
          target: leafId,
          sourcePosition: 'right',
          targetPosition: 'left',
          type: 'default',
        });

        const localTracker = { y: itemY };
        for (const [innerKey, innerValue] of Object.entries(item)) {
          if (nodeCounter.count >= maxNodes) {
            truncated = true;
            break;
          }
          const isInnerObject = typeof innerValue === 'object' && innerValue !== null;
          const isInnerArray = Array.isArray(innerValue);
          if (isInnerObject || isInnerArray) {
            const result = parseJSONToFlowFixed(
              { [innerKey]: innerValue },
              leafId,
              `${leafId}_${innerKey}`,
              nodes,
              edges,
              depth + 3,
              localTracker,
              nodeCounter,
              maxNodes
            );
            if (result.truncated) truncated = true;
          }
        }

        itemY = Math.max(itemY + estimateNodeHeight(item) + 30, localTracker.y);
      }
      positionTracker.y = itemY;
    }

    if (isArrayOfPrimitives) {
      for (let i = 0; i < value.length; i++) {
        if (nodeCounter.count >= maxNodes) {
          truncated = true;
          break;
        }
        const item = value[i];
        const itemY = positionTracker.y;
        const itemHeight = estimateNodeHeight(item);
        positionTracker.y += itemHeight;

        const primitiveId = `${nodeId}_val${i}`;
        nodes.push({
          id: primitiveId,
          data: { label: null, value: item, isRoot: false },
          position: { x: currentX + 2 * nodeSpacingX, y: itemY },
          ...nodeDefaults,
          type: 'customNode',
        });
        nodeCounter.count++;

        edges.push({
          id: `${nodeId}-${primitiveId}`,
          source: nodeId,
          target: primitiveId,
          sourcePosition: 'right',
          targetPosition: 'left',
          type: 'default',
        });
      }
    }
  }
  return { nodes, edges, nextY: positionTracker.y, truncated };
}

function JsonViewerInner({ inputJSON }) {
  const [highlightedNodeIds, setHighlightedNodeIds] = useState([]);
  const [highlightedEdgeIds, setHighlightedEdgeIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [maxNodes, setMaxNodes] = useState(DEFAULT_MAX_NODES);
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const { setCenter } = useReactFlow();

  // Reset node limit when input changes
  useEffect(() => {
    setMaxNodes(DEFAULT_MAX_NODES);
    setIsPlaying(false);
    setPlaybackIndex(-1);
    setHighlightedNodeIds([]);
    setHighlightedEdgeIds([]);
  }, [inputJSON]);

  const normalizedJSON = useMemo(() => normalizeInput(inputJSON), [inputJSON]);

  const { nodes, edges, truncated } = useMemo(() => {
    return parseJSONToFlowFixed(
      normalizedJSON,
      '', '', [], [], 0,
      { y: 180 },
      { count: 0 },
      maxNodes
    );
  }, [normalizedJSON, maxNodes]);

  const playbackSequence = useMemo(() => buildPlaybackSequence(nodes, edges), [nodes, edges]);
  const playbackCurrentNodeId =
    playbackIndex >= 0 && playbackIndex < playbackSequence.length
      ? playbackSequence[playbackIndex]
      : null;
  const playbackVisitedNodeIds = useMemo(
    () => new Set(playbackIndex >= 0 ? playbackSequence.slice(0, playbackIndex + 1) : []),
    [playbackIndex, playbackSequence]
  );

  useEffect(() => {
    setLoading(true);
    const timeout = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(timeout);
  }, [inputJSON]);

  const handleLoadMore = useCallback(() => {
    setMaxNodes(prev => prev + LOAD_MORE_INCREMENT);
  }, []);

  const focusNode = useCallback((nodeId, duration = 650) => {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      return;
    }

    setCenter(node.position.x + 100, node.position.y + 40, { zoom: 1, duration });
  }, [nodes, setCenter]);

  const applyNodeLineageHighlight = useCallback((nodeId) => {
    const { nodeIds, edgeIds } = collectNodeLineage(nodeId, edges);
    setHighlightedNodeIds(nodeIds);
    setHighlightedEdgeIds(edgeIds);
  }, [edges]);

  const handleNodeClick = useCallback((clickedNode) => {
    setIsPlaying(false);
    setPlaybackIndex(-1);
    applyNodeLineageHighlight(clickedNode.id);
    focusNode(clickedNode.id, 450);
  }, [applyNodeLineageHighlight, focusNode]);

  const handlePaneClick = useCallback(() => {
    setIsPlaying(false);
    setPlaybackIndex(-1);
    setHighlightedNodeIds([]);
    setHighlightedEdgeIds([]);
  }, []);

  const handlePlayPause = useCallback(() => {
    if (playbackSequence.length === 0) {
      return;
    }

    if (isPlaying) {
      setIsPlaying(false);
      return;
    }

    setPlaybackIndex((currentIndex) => {
      if (currentIndex < 0 || currentIndex >= playbackSequence.length - 1) {
        return 0;
      }
      return currentIndex;
    });
    setIsPlaying(true);
  }, [isPlaying, playbackSequence.length]);

  const handleReplay = useCallback(() => {
    if (playbackSequence.length === 0) {
      return;
    }

    setPlaybackIndex(0);
    setIsPlaying(true);
  }, [playbackSequence.length]);

  useEffect(() => {
    if (!playbackCurrentNodeId) {
      return;
    }

    applyNodeLineageHighlight(playbackCurrentNodeId);
    focusNode(playbackCurrentNodeId, isPlaying ? 700 : 450);
  }, [applyNodeLineageHighlight, focusNode, isPlaying, playbackCurrentNodeId]);

  useEffect(() => {
    if (!isPlaying || playbackSequence.length === 0) {
      return undefined;
    }

    if (playbackIndex < 0) {
      setPlaybackIndex(0);
      return undefined;
    }

    if (playbackIndex >= playbackSequence.length - 1) {
      setIsPlaying(false);
      return undefined;
    }

    const timeout = setTimeout(() => {
      setPlaybackIndex((currentIndex) => currentIndex + 1);
    }, WALKTHROUGH_STEP_MS);

    return () => clearTimeout(timeout);
  }, [isPlaying, playbackIndex, playbackSequence]);

  // Compute search matches
  useEffect(() => {
    if (!searchQuery.trim()) {
      setMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }
    
    const lowerQuery = searchQuery.toLowerCase();
    const matchesValue = (candidate) => {
      if (isPrimitiveValue(candidate)) {
        return String(candidate).toLowerCase().includes(lowerQuery);
      }
      if (isInlineArrayValue(candidate)) {
        return candidate.some((item) => String(item).toLowerCase().includes(lowerQuery));
      }
      return false;
    };

    const newMatches = nodes.filter(node => {
      const { label, value } = node.data;
      if (label && String(label).toLowerCase().includes(lowerQuery)) return true;
      if (matchesValue(value)) {
        return true;
      } else if (value && typeof value === 'object') {
        return Object.values(value).some(matchesValue);
      }
      return false;
    }).map(n => n.id);

    setMatches(newMatches);
    setCurrentMatchIndex(newMatches.length > 0 ? 0 : -1);
  }, [searchQuery, nodes]);

  // Center on current match
  useEffect(() => {
    if (currentMatchIndex >= 0 && matches.length > 0) {
      const matchNode = nodes.find(n => n.id === matches[currentMatchIndex]);
      if (matchNode) {
        setCenter(matchNode.position.x + 100, matchNode.position.y + 40, { zoom: 1, duration: 500 });
      }
    }
  }, [currentMatchIndex, matches, nodes, setCenter]);

  const handleNextMatch = () => {
    if (matches.length > 0) {
      setCurrentMatchIndex(prev => (prev + 1) % matches.length);
    }
  };

  const handlePrevMatch = () => {
    if (matches.length > 0) {
      setCurrentMatchIndex(prev => (prev - 1 + matches.length) % matches.length);
    }
  };

  const playbackCurrentNode = useMemo(() => {
    if (!playbackCurrentNodeId) {
      return null;
    }

    return nodes.find((node) => node.id === playbackCurrentNodeId) ?? null;
  }, [nodes, playbackCurrentNodeId]);

  const playbackCurrentLabel = useMemo(() => {
    if (!playbackCurrentNode) {
      return 'Step through the graph from the root node to the last branch.';
    }

    const formattedLabel = formatNodeLabel(
      playbackCurrentNode.data.label,
      playbackCurrentNode.data.isRoot
    );

    if (formattedLabel) {
      return formattedLabel;
    }

    if (playbackCurrentNode.id === 'ROOT' || playbackCurrentNode.data.isRoot) {
      return 'Root';
    }

    if (isPrimitiveValue(playbackCurrentNode.data.value)) {
      return `Value: ${formatInlineValue(playbackCurrentNode.data.value)}`;
    }

    return playbackCurrentNode.id;
  }, [playbackCurrentNode]);

  const processedNodes = useMemo(() => nodes.map(node => {
    const isMatched = matches.includes(node.id);
    const isCurrentMatch = matches[currentMatchIndex] === node.id;
    const isClicked = highlightedNodeIds.includes(node.id);
    const isCurrentPlaybackNode = playbackCurrentNodeId === node.id;
    const isVisitedPlaybackNode = playbackVisitedNodeIds.has(node.id);

    let border = node.style?.border;
    let background = node.style?.background;
    let boxShadow = node.style?.boxShadow;
    let animation = node.style?.animation;

    if (isCurrentPlaybackNode) {
      border = '2px solid #FF9F1C';
      background = 'rgba(255, 159, 28, 0.22)';
      boxShadow = '0 0 24px rgba(255, 159, 28, 0.28)';
      animation = 'nodePulse 1.1s ease-in-out infinite';
    } else if (isCurrentMatch) {
      border = '2px solid #00FF7F';
      background = 'rgba(0, 255, 127, 0.2)';
    } else if (isMatched) {
      border = '1px solid #00FF7F';
      background = 'rgba(0, 255, 127, 0.1)';
    } else if (isClicked) {
      border = '2px solid #FFED29';
      background = 'rgba(255, 237, 41, 0.2)';
    } else if (isVisitedPlaybackNode) {
      border = '1px solid #58A6FF';
      background = 'rgba(88, 166, 255, 0.14)';
    }

    return {
      ...node,
      style: {
        ...node.style,
        border,
        background,
        boxShadow,
        animation,
      },
    };
  }), [
    nodes,
    highlightedNodeIds,
    matches,
    currentMatchIndex,
    playbackCurrentNodeId,
    playbackVisitedNodeIds,
  ]);

  const processedEdges = useMemo(() => edges.map(edge => {
    const isHighlighted = highlightedEdgeIds.includes(edge.id);

    return {
      ...edge,
      animated: isHighlighted,
      style: {
        ...edge.style,
        stroke: isHighlighted ? '#FFB347' : '#999',
        strokeWidth: isHighlighted ? 2.5 : 1,
      },
    };
  }), [edges, highlightedEdgeIds]);

  if (loading) {
    return (
      <Box sx={{ width: '100%', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#181818' }}>
        <CircularProgress color="inherit" />
      </Box>
    );
  }

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
      {/* Search Bar */}
      <Box
        sx={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          background: 'rgba(30, 30, 30, 0.95)',
          border: '1px solid #444',
          borderRadius: '8px',
          padding: '4px 12px',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}
      >
        <SearchIcon sx={{ color: '#aaa', mr: 1, fontSize: 20 }} />
        <input
          type="text"
          placeholder="Search JSON..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleNextMatch();
          }}
          style={{
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#fff',
            fontFamily: 'monospace',
            width: '160px',
            fontSize: '13px'
          }}
        />
        {matches.length > 0 && (
          <Typography sx={{ color: '#aaa', fontSize: '12px', fontFamily: 'monospace', mx: 1, whiteSpace: 'nowrap' }}>
            {currentMatchIndex + 1} / {matches.length}
          </Typography>
        )}
        {searchQuery && matches.length === 0 && (
          <Typography sx={{ color: '#FF5C8D', fontSize: '12px', fontFamily: 'monospace', mx: 1 }}>
            0/0
          </Typography>
        )}
        <Divider orientation="vertical" flexItem sx={{ borderColor: '#444', mx: 0.5, my: 0.5 }} />
        <IconButton size="small" onClick={handlePrevMatch} disabled={matches.length === 0} sx={{ color: matches.length > 0 ? '#58A6FF' : '#555', padding: '4px' }}>
          <KeyboardArrowUpIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={handleNextMatch} disabled={matches.length === 0} sx={{ color: matches.length > 0 ? '#58A6FF' : '#555', padding: '4px' }}>
          <KeyboardArrowDownIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={() => setSearchQuery('')} sx={{ color: '#aaa', padding: '4px', ml: 0.5 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {truncated && (
        <Box
          sx={{
            position: 'absolute',
            top: 12,
            left: 12,
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            background: 'rgba(30, 30, 30, 0.95)',
            border: '1px solid #444',
            borderRadius: '8px',
            padding: '8px 18px',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <Typography
            sx={{
              color: '#FFB74D',
              fontFamily: 'monospace',
              fontSize: '13px',
            }}
          >
            ⚠ Showing {nodes.length} of many nodes
          </Typography>
          <Button
            variant="outlined"
            size="small"
            onClick={handleLoadMore}
            sx={{
              color: '#58A6FF',
              borderColor: '#58A6FF',
              fontFamily: 'monospace',
              fontSize: '12px',
              textTransform: 'none',
              '&:hover': {
                background: 'rgba(88,166,255,0.15)',
                borderColor: '#79b8ff',
              },
            }}
          >
            Show {LOAD_MORE_INCREMENT} more
          </Button>
        </Box>
      )}

      <Box
        sx={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          maxWidth: 'min(520px, calc(100% - 24px))',
          background: 'rgba(30, 30, 30, 0.95)',
          border: '1px solid #444',
          borderRadius: '10px',
          padding: '10px 14px',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}
      >
        <Button
          variant="contained"
          size="small"
          startIcon={isPlaying ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
          onClick={handlePlayPause}
          disabled={playbackSequence.length === 0}
          sx={{
            background: '#58A6FF',
            color: '#0d1117',
            fontFamily: 'monospace',
            fontSize: '12px',
            fontWeight: 700,
            textTransform: 'none',
            '&:hover': {
              background: '#79b8ff',
            },
            '&:disabled': {
              background: '#444',
              color: '#777',
            },
          }}
        >
          {isPlaying ? 'Pause walkthrough' : 'Start walkthrough'}
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<ReplayIcon fontSize="small" />}
          onClick={handleReplay}
          disabled={playbackSequence.length === 0}
          sx={{
            color: '#aaa',
            borderColor: '#555',
            fontFamily: 'monospace',
            fontSize: '12px',
            textTransform: 'none',
            '&:hover': {
              borderColor: '#79b8ff',
              background: 'rgba(88,166,255,0.12)',
            },
          }}
        >
          Restart
        </Button>
        <Divider orientation="vertical" flexItem sx={{ borderColor: '#444' }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              color: '#fff',
              fontFamily: 'monospace',
              fontSize: '12px',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            Walkthrough {playbackIndex >= 0 ? playbackIndex + 1 : 0} / {playbackSequence.length}
          </Typography>
          <Typography
            sx={{
              color: '#9fb3c8',
              fontFamily: 'monospace',
              fontSize: '11px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={playbackCurrentLabel}
          >
            {playbackCurrentLabel}
          </Typography>
        </Box>
      </Box>

      <ReactFlow
        nodes={processedNodes}
        edges={processedEdges}
        nodeTypes={nodeTypes}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        panOnScroll={true}
        panOnDrag={true}
        onNodeClick={(_, node) => handleNodeClick(node)}
        onPaneClick={handlePaneClick}
        style={{ background: '#181818' }}
        minZoom={0.1}
      >
        <Background color="#333" variant="dots" gap={12} />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function JsonViewer({ inputJSON }) {
  return (
    <ReactFlowProvider>
      <JsonViewerInner inputJSON={inputJSON} />
    </ReactFlowProvider>
  );
}
