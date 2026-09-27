import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { CHILD_PAGE_SIZE } from '../../utils/graph';
import { highlightText } from '../SearchBox';

const SHOW_ALL_LIMIT = 500;
export const APPROX_TITLE =
  'This integer is too large for JavaScript to represent exactly, so it is shown rounded. The editor text and the details panel keep the exact value.';

function Handles({ direction }) {
  const horizontal = direction === 'LR';
  return (
    <>
      <Handle type="target" position={horizontal ? Position.Left : Position.Top} className="je-handle" isConnectable={false} />
      <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} className="je-handle" isConnectable={false} />
    </>
  );
}

/** A JSON object/array (or a primitive root) rendered as a card with one row per inline value. */
export const JsonNode = memo(function JsonNode({ data }) {
  const { view, isRoot, childCount, collapsed, direction, query, selectedRow } = data;

  return (
    <div className={`je-node is-${view.kind}${isRoot ? ' is-root' : ''}`}>
      <Handles direction={direction} />
      <div className="je-node-header">
        <span className="je-node-label">{highlightText(view.label, query)}</span>
        {view.hint && <span className="je-node-hint">{highlightText(view.hint, query)}</span>}
        {view.chip && <span className={`je-node-chip is-${view.kind}`}>{view.chip}</span>}
      </div>

      {view.kind === 'value' ? (
        <div className="je-node-rows">
          <div className="je-row is-value" data-row-index="-1" title={view.text}>
            <span className={`je-v is-${view.valueKind}`}>
              {view.approx && (
                <span className="je-approx" title={APPROX_TITLE}>
                  ≈
                </span>
              )}
              {highlightText(view.text, query)}
            </span>
          </div>
        </div>
      ) : (
        view.rows.length > 0 && (
          <div className="je-node-rows">
            {view.rows.map((row, index) => (
              <div
                key={row.keyText}
                className={`je-row${selectedRow !== undefined && selectedRow === row.key ? ' is-selected' : ''}`}
                data-row-index={index}
                title={`${row.keyText}: ${row.text}`}
              >
                <span className={`je-k${typeof row.key === 'number' ? ' is-index' : ''}`}>{highlightText(row.keyText, query)}</span>
                <span className={`je-v is-${row.kind}`}>
                  {row.approx && (
                    <span className="je-approx" title={APPROX_TITLE}>
                      ≈
                    </span>
                  )}
                  {highlightText(row.text, query)}
                </span>
              </div>
            ))}
            {view.hiddenRows > 0 && (
              <div className="je-row is-more" data-row-index="more">
                +{view.hiddenRows.toLocaleString('en-US')} more — open details to see all
              </div>
            )}
          </div>
        )
      )}

      {childCount > 0 && (
        <button
          type="button"
          tabIndex={-1}
          className={`je-node-toggle is-${direction === 'LR' ? 'lr' : 'tb'}${collapsed ? ' is-collapsed' : ''}`}
          data-toggle="true"
          aria-label={collapsed ? `Expand ${childCount} child nodes` : 'Collapse child nodes'}
          aria-expanded={!collapsed}
          title={collapsed ? `Expand ${childCount} child node${childCount === 1 ? '' : 's'}` : 'Collapse'}
        >
          {collapsed ? `+${childCount.toLocaleString('en-US')}` : '−'}
        </button>
      )}
    </div>
  );
});

/** Placeholder for children beyond the current page of a very wide node. */
export const MoreNode = memo(function MoreNode({ data }) {
  const { remaining, direction } = data;
  const next = Math.min(CHILD_PAGE_SIZE, remaining);
  return (
    <div className="je-more-node">
      <Handles direction={direction} />
      <button type="button" tabIndex={-1} data-more="page" className="je-more-btn">
        Show {next} more
      </button>
      {remaining > next && remaining <= SHOW_ALL_LIMIT && (
        <button type="button" tabIndex={-1} data-more="all" className="je-more-btn is-secondary">
          All {remaining}
        </button>
      )}
      <span className="je-more-count">{remaining.toLocaleString('en-US')} hidden</span>
    </div>
  );
});

export const nodeTypes = { json: JsonNode, more: MoreNode };
