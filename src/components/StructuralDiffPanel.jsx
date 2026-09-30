import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import SwapVertRoundedIcon from '@mui/icons-material/SwapVertRounded';
import SyncAltRoundedIcon from '@mui/icons-material/SyncAltRounded';
import { formatPath, previewValue } from '../utils/json';

const KIND_META = {
  added: { icon: <AddRoundedIcon fontSize="inherit" />, label: 'Added' },
  removed: { icon: <RemoveRoundedIcon fontSize="inherit" />, label: 'Removed' },
  changed: { icon: <SyncAltRoundedIcon fontSize="inherit" />, label: 'Changed' },
  moved: { icon: <SwapVertRoundedIcon fontSize="inherit" />, label: 'Moved' },
};

function ChangeRow({ change, onReveal }) {
  const meta = KIND_META[change.kind];
  return (
    <li>
      <button type="button" className={`je-diff-row is-${change.kind}`} onClick={() => onReveal(change)} title="Show in both editors">
        <span className="je-diff-kind" aria-label={meta.label}>
          {meta.icon}
        </span>
        <code className="je-diff-path">{formatPath(change.path)}</code>
        <span className="je-diff-values">
          {(change.kind === 'added' || change.kind === 'moved') && <span className="je-diff-after">{previewValue(change.after, 60)}</span>}
          {change.kind === 'moved' && <span className="je-diff-was">from {formatPath(change.leftPath)}</span>}
          {change.kind === 'removed' && <span className="je-diff-before">{previewValue(change.before, 60)}</span>}
          {change.kind === 'changed' && (
            <>
              <span className="je-diff-before">{previewValue(change.before, 40)}</span>
              <span className="je-diff-arrow" aria-hidden="true">
                →
              </span>
              <span className="je-diff-after">{previewValue(change.after, 40)}</span>
              {change.typeChanged && <span className="je-diff-note">type changed</span>}
            </>
          )}
        </span>
      </button>
    </li>
  );
}

export function StructuralDiffPanel({ state, open, onToggle, onReveal }) {
  const { status, result, leftError, rightError } = state;
  const counts = result?.counts;

  return (
    <section className={`je-diff-panel${open ? ' is-open' : ''}`} aria-label="Structural differences">
      <button type="button" className="je-diff-panel-header" onClick={onToggle} aria-expanded={open}>
        <ExpandMoreRoundedIcon fontSize="small" className="je-diff-panel-chevron" />
        <strong>Structural differences</strong>
        {status === 'ready' && result.total > 0 && (
          <span className="je-diff-counts">
            <span className="je-diff-count is-added">+{counts.added}</span>
            <span className="je-diff-count is-removed">−{counts.removed}</span>
            <span className="je-diff-count is-changed">~{counts.changed}</span>
            {counts.moved > 0 && <span className="je-diff-count is-moved">↕{counts.moved}</span>}
          </span>
        )}
        {status === 'ready' && result.total === 0 && (
          <span className="je-diff-equal">
            <CheckCircleRoundedIcon fontSize="inherit" /> Equivalent
          </span>
        )}
        <span className="je-diff-hint">Compares values, not text — key order and formatting are ignored</span>
      </button>

      {open && (
        <div className="je-diff-body">
          {status === 'pending' && <p className="je-diff-message">Comparing…</p>}
          {status === 'invalid' && (
            <p className="je-diff-message is-error">
              Fix the JSON errors to compare structure.
              {leftError && <span> Original: {leftError}.</span>}
              {rightError && <span> Modified: {rightError}.</span>}
            </p>
          )}
          {status === 'ready' && result.total === 0 && (
            <p className="je-diff-message">
              No structural differences. The documents contain the same data, even if the text differs in formatting or key order.
            </p>
          )}
          {status === 'ready' && result.total > 0 && (
            <>
              <ul className="je-diff-list">
                {result.changes.map((change) => (
                  <ChangeRow key={`${change.kind}:${JSON.stringify(change.leftPath)}:${JSON.stringify(change.rightPath)}`} change={change} onReveal={onReveal} />
                ))}
              </ul>
              {result.truncated && (
                <p className="je-diff-message">
                  Showing the first {result.changes.length.toLocaleString('en-US')} of {result.total.toLocaleString('en-US')} differences.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
