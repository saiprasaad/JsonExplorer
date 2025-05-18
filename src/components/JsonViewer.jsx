import { Box, Divider, Typography } from '@mui/material';
import React, { useMemo, useState } from 'react';
import ReactFlow, { Background, Controls, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';

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
    const entries = Object.entries(obj).filter(([_, val]) => isPrimitive(val));
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
        overflow: 'hidden', // Only on the container
        // Remove whiteSpace and textOverflow from here!
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

function parseJSONToFlowFixed(
  json,
  parentId = '',
  parentPath = '',
  nodes = [],
  edges = [],
  depth = 0,
  positionTracker = { y: 180 }
) {
  const isPrimitive = (val) => val !== null && (typeof val !== 'object' || val instanceof Date);
  const estimateNodeHeight = (value) => {
    if (!value || typeof value !== 'object') return 60;
    if (Array.isArray(value)) return 80 + value.length * 30;
    const visibleEntries = Object.values(value).filter(
      v => v !== null && typeof v !== 'object'
    );
    return 80 + visibleEntries.length * 26;
  };

  const nodeSpacingX = 320;
  const currentX = depth * nodeSpacingX;

  if (
    depth === 0 &&
    !nodes.some((n) => n.id === 'ROOT') &&
  Object.keys(json).length > 1 
  ) {
    const rootY = positionTracker.y;
    nodes.push({
      id: 'ROOT',
      data: { label: '', value: json, isRoot: true },
      position: { x:  currentX, y: rootY },
      ...nodeDefaults,
      type: 'customNode',
    });
    positionTracker.y += 60;
  }

  for (const [key, value] of Object.entries(json)) {
    const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
    const isArrayOfObjects = Array.isArray(value) && value.every(v => typeof v === 'object' && v !== null);
    const isArrayOfPrimitives = Array.isArray(value) && value.every(v => isPrimitive(v));
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

    edges.push({
      id: `${depth === 0 ? 'ROOT' : parentId}-${nodeId}`,
      source: depth === 0 ? 'ROOT' : parentId,
      target: nodeId,
      sourcePosition: 'right',
      targetPosition: 'left',
      type: 'default',
    });

    if (isObject) {
      parseJSONToFlowFixed(value, nodeId, nodeId, nodes, edges, depth + 1, positionTracker);
    }

    if (isArrayOfObjects) {
      let itemY = yForThisNode;
      if (depth === 1 && Object.keys(json)[0] === key) itemY += 30;
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        const leafId = `${nodeId}_item${i}`;
        const itemX = currentX + 2 * nodeSpacingX;

        nodes.push({
          id: leafId,
          data: { label: item.id || '', value: item, isRoot: false },
          position: { x: itemX, y: itemY },
          ...nodeDefaults,
          type: 'customNode',
        });

        edges.push({
          id: `${nodeId}-${leafId}`,
          source: nodeId,
          target: leafId,
          sourcePosition: 'right',
          targetPosition: 'left',
          type: 'default',
        });

        for (const [innerKey, innerValue] of Object.entries(item)) {
          const isInnerObject = typeof innerValue === 'object' && innerValue !== null;
          const isInnerArray = Array.isArray(innerValue);
          if (isInnerObject || isInnerArray) {
            parseJSONToFlowFixed(
              { [innerKey]: innerValue },
              leafId,
              `${leafId}_${innerKey}`,
              nodes,
              edges,
              depth + 3,
              positionTracker
            );
          }
        }
        itemY += estimateNodeHeight(item) + 20;
      }
      positionTracker.y = itemY;
    }

    if (isArrayOfPrimitives) {
      for (let i = 0; i < value.length; i++) {
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
  return { nodes, edges, nextY: positionTracker.y };
}

export function JsonViewer({ inputJSON }) {
  const { nodes, edges } = parseJSONToFlowFixed(inputJSON);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState([]);
  const [highlightedEdgeIds, setHighlightedEdgeIds] = useState([]);

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

  const processedNodes = useMemo(() => nodes.map(node => ({
    ...node,
    style: {
      ...node.style,
      border: highlightedNodeIds.includes(node.id) ? '2px solid #FFED29' : node.style?.border,
      background: highlightedNodeIds.includes(node.id) ? '#FFED29' : node.style?.background,
    },
  })), [nodes, highlightedNodeIds]);

  const processedEdges = useMemo(() => edges.map(edge => ({
    ...edge,
    style: {
      ...edge.style,
      stroke: highlightedEdgeIds.includes(edge.id) ? '#FFED29' : '#999',
      strokeWidth: highlightedEdgeIds.includes(edge.id) ? 2.5 : 1,
    },
  })), [edges, highlightedEdgeIds]);

  // const FocusOnRootNode = () => {
  //   const { setViewport } = useReactFlow();
  //   useEffect(() => {
  //     if (!nodes.length) return;
  //     const targetNode = nodes.find(node => edges.every(edge => edge.target !== node.id));
  //     if (targetNode) {
  //       const { x, y } = targetNode.position;
  //       setViewport({ x: x + 200, y: y + 200, zoom: 1 }, { duration: 500 });
  //     }
  //   }, []);
  //   return null;
  // };

  return (
    <div style={{ width: '100%', height: '100vh' }}>
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
        {/* To scroll or focus on parent, use this <FocusOnRootNode /> */}
        <Background color="#333" variant="dots" gap={12} />
        <Controls />
      </ReactFlow>
    </div>
  );
}