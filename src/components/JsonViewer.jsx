import { Box, Divider, Typography, CircularProgress, Button, TextField, IconButton } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import CloseIcon from '@mui/icons-material/Close';
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import ReactFlow, { Background, Controls, Handle, Position, useReactFlow, ReactFlowProvider } from 'reactflow';
import 'reactflow/dist/style.css';

const DEFAULT_MAX_NODES = 200;
const LOAD_MORE_INCREMENT = 100;

const nodeDefaults = {
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
};

const JsonNode = ({ data, isConnectable }) => {
  const { label, value, isRoot } = data;
  const isPrimitive = (val) => val !== null && typeof val !== 'object';
  const getValueStyle = (val) => {
    if (typeof val === 'boolean') return { color: val ? '#00FF7F' : '#FF5C8D' };
    if (Number.isInteger(val)) return { color: 'yellow' };
    if (typeof val === 'string') return { color: 'white' };
    return { color: 'white' };
  };

  const renderObjectValues = (obj) => {
    const entries = Object.entries(obj).filter(([, val]) => isPrimitive(val));
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
          title={`${key}: ${val}`}
        >
          <span style={{ color: "#58A6FF", fontWeight: 'bold' }}>{key}:</span>
          <span style={getValueStyle(val)}>{String(val)}</span>
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
      {isPrimitive(value) ? (
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
            {isRoot
              ? label
              : (
                  (typeof label === 'string' && !/_item\d+$/.test(label))
                    ? label.replace(/^\d+\|?/, '')
                    : ''
                )
            }
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

function parseJSONToFlowFixed(
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

  const isPrimitive = (val) => val !== null && (typeof val !== 'object' || val instanceof Date);
  const estimateNodeHeight = (value) => {
    if (!value || typeof value !== 'object') return 60;
    if (Array.isArray(value)) return 80 + Math.min(value.length, 5) * 30;
    const visibleEntries = Object.values(value).filter(
      v => v !== null && typeof v !== 'object'
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
    const isArrayOfObjects = Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'object' && v !== null);
    const isArrayOfPrimitives = Array.isArray(value) && value.length > 0 && value.every(v => isPrimitive(v));
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

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const { setCenter } = useReactFlow();

  // Reset node limit when input changes
  useEffect(() => {
    setMaxNodes(DEFAULT_MAX_NODES);
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

  useEffect(() => {
    setLoading(true);
    const timeout = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(timeout);
  }, [inputJSON]);

  const handleLoadMore = useCallback(() => {
    setMaxNodes(prev => prev + LOAD_MORE_INCREMENT);
  }, []);

  const handleNodeClick = (clickedNode) => {
    const connectedEdges = [];
    const connectedNodes = new Set();
    const collectParentNodes = (nodeId) => {
      connectedNodes.add(nodeId);
      edges.forEach(edge => {
        if (edge.target === nodeId && !connectedNodes.has(edge.source)) {
          connectedEdges.push(edge.id);
          collectParentNodes(edge.source);
        }
      });
    };
    collectParentNodes(clickedNode.id);
    setHighlightedNodeIds([...connectedNodes]);
    setHighlightedEdgeIds(connectedEdges);
  };

  // Compute search matches
  useEffect(() => {
    if (!searchQuery.trim()) {
      setMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }
    
    const lowerQuery = searchQuery.toLowerCase();
    const newMatches = nodes.filter(node => {
      const { label, value } = node.data;
      if (label && String(label).toLowerCase().includes(lowerQuery)) return true;
      if (value !== null && typeof value !== 'object') {
        if (String(value).toLowerCase().includes(lowerQuery)) return true;
      } else if (value && typeof value === 'object') {
        // Search primitive values in the object/array
        return Object.values(value).some(
          v => v !== null && typeof v !== 'object' && String(v).toLowerCase().includes(lowerQuery)
        );
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

  const processedNodes = useMemo(() => nodes.map(node => {
    const isMatched = matches.includes(node.id);
    const isCurrentMatch = matches[currentMatchIndex] === node.id;
    const isClicked = highlightedNodeIds.includes(node.id);
    
    let border = node.style?.border;
    let background = node.style?.background;

    if (isCurrentMatch) {
      border = '2px solid #00FF7F';
      background = 'rgba(0, 255, 127, 0.2)';
    } else if (isMatched) {
      border = '1px solid #00FF7F';
      background = 'rgba(0, 255, 127, 0.1)';
    } else if (isClicked) {
      border = '2px solid #FFED29';
      background = '#FFED29';
    }

    return {
      ...node,
      style: {
        ...node.style,
        border,
        background,
      },
    };
  }), [nodes, highlightedNodeIds, matches, currentMatchIndex]);

  const processedEdges = useMemo(() => edges.map(edge => ({
    ...edge,
    style: {
      ...edge.style,
      stroke: highlightedEdgeIds.includes(edge.id) ? '#FFED29' : '#999',
      strokeWidth: highlightedEdgeIds.includes(edge.id) ? 2.5 : 1,
    },
  })), [edges, highlightedEdgeIds]);

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
            left: '50%',
            transform: 'translateX(-50%)',
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
      <ReactFlow
        nodes={processedNodes}
        edges={processedEdges}
        nodeTypes={nodeTypes}
        zoomOnScroll={false}
        panOnScroll
        panOnDrag
        onNodeClick={(_, node) => handleNodeClick(node)}
        onPaneClick={() => {
          setHighlightedNodeIds([]);
          setHighlightedEdgeIds([]);
        }}
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