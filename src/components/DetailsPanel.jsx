import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DataObjectRoundedIcon from '@mui/icons-material/DataObjectRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded';
import TransformRoundedIcon from '@mui/icons-material/TransformRounded';
import { useMemo } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { isTabular } from '../utils/convert';
import { copyText } from '../utils/files';
import { isImpreciseNumber } from '../utils/graph';
import { formatBytes, formatPath, getValueAtPath, getValueType, PATH_FORMATS, pluralize, utf8ByteLength, valueJsonText } from '../utils/json';
import { DataTable } from './DataTable';
import { JsonHighlight } from './JsonHighlight';
import { useNotify } from './Notifier';
import { ToolButton } from './ToolButton';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CSS_COLOR = /^(?:rgb|rgba|hsl|hsla)\(\s*[\d.%\s,/]+\)$/i;

function relativeTime(date) {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(seconds, 'second');
}

function formatDate(date) {
  return `${date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })} (${relativeTime(date)})`;
}

/** Recognises values worth previewing: links, dates, timestamps, colors and inline images. */
export function describeSmartValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^https?:\/\/\S+$/i.test(trimmed)) return { kind: 'url', label: 'Link', url: trimmed };
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(trimmed)) return { kind: 'image', label: 'Image', url: trimmed };
    if (HEX_COLOR.test(trimmed) || CSS_COLOR.test(trimmed)) return { kind: 'color', label: 'Color', color: trimmed };
    if (ISO_DATE.test(trimmed)) {
      const date = new Date(trimmed);
      if (!Number.isNaN(date.getTime())) return { kind: 'date', label: 'Date', text: formatDate(date) };
    }
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    // Unix timestamps between 2001 and 2100, in seconds or milliseconds.
    const milliseconds = value > 1e12 && value < 4.1e12 ? value : value > 1e9 && value < 4.1e9 ? value * 1000 : null;
    if (milliseconds !== null) return { kind: 'date', label: 'As timestamp', text: formatDate(new Date(milliseconds)) };
  }
  return null;
}

function segmentLabel(segment) {
  return typeof segment === 'number' ? `[${segment}]` : segment === '' ? '""' : segment;
}

/** Pretty JSON for a value, taken losslessly from the source text when possible. */
function useDisplayText(value, path, sourceText) {
  return useMemo(() => valueJsonText(sourceText, path, value), [path, sourceText, value]);
}

export function DetailsPanel({ root, path, sourceText, onClose, onSelectPath, onRevealInEditor, onConvert, compact }) {
  const notify = useNotify();
  const [pathFormat, setPathFormat] = usePersistentState('pathFormat', 'jsonpath', {
    validate: (candidate) => PATH_FORMATS.some((format) => format.id === candidate),
  });
  const [preferredTab, setTab] = usePersistentState('detailsTab', 'json', { validate: (candidate) => candidate === 'json' || candidate === 'table' });

  const value = getValueAtPath(root, path);
  const type = getValueType(value);
  const formattedPath = formatPath(path, pathFormat);
  const smart = useMemo(() => describeSmartValue(value), [value]);
  const display = useDisplayText(value, path, sourceText);
  const serialized = useMemo(() => {
    const text = JSON.stringify(value);
    return { size: text ? utf8ByteLength(text) : 0 };
  }, [value]);
  const tabular = useMemo(() => isTabular(value), [value]);

  if (value === undefined) return null;
  const imprecise = isImpreciseNumber(value);
  const showTable = tabular && preferredTab === 'table';

  const title = path.length === 0 ? 'root' : segmentLabel(path[path.length - 1]);
  const count =
    type === 'array' ? pluralize(value.length, 'item') : type === 'object' ? pluralize(Object.keys(value).length, 'key') : null;

  const copy = async (content, label) => {
    const copied = await copyText(content);
    notify(copied ? `${label} copied to the clipboard.` : 'Copy failed.', copied ? 'success' : 'error');
  };

  return (
    <aside className={`je-details${compact ? ' is-sheet' : ''}${showTable && !compact ? ' is-wide' : ''}`} aria-label="Details">
      <header className="je-details-header">
        <div className="je-details-title">
          <h2 title={String(title)}>{title}</h2>
          <span className={`je-type-badge is-${type}`}>{type}</span>
        </div>
        {onRevealInEditor && (
          <ToolButton label="Show in editor" icon={<CodeRoundedIcon fontSize="small" />} onClick={() => onRevealInEditor(path)} />
        )}
        <ToolButton label="Close details (Esc)" icon={<CloseRoundedIcon fontSize="small" />} onClick={onClose} />
      </header>

      <nav className="je-breadcrumbs" aria-label="Path">
        <button type="button" onClick={() => onSelectPath([])} aria-current={path.length === 0 ? 'location' : undefined}>
          root
        </button>
        {path.map((segment, index) => (
          <span key={`${index}-${segment}`} className="je-breadcrumb">
            <span className="je-breadcrumb-sep" aria-hidden="true">
              ›
            </span>
            <button
              type="button"
              onClick={() => onSelectPath(path.slice(0, index + 1))}
              aria-current={index === path.length - 1 ? 'location' : undefined}
            >
              {segmentLabel(segment)}
            </button>
          </span>
        ))}
      </nav>

      <div className="je-details-path">
        <select value={pathFormat} onChange={(event) => setPathFormat(event.target.value)} aria-label="Path format">
          {PATH_FORMATS.map((format) => (
            <option key={format.id} value={format.id}>
              {format.label}
            </option>
          ))}
        </select>
        <code title={formattedPath}>{formattedPath || '(root)'}</code>
        <ToolButton label="Copy path" icon={<ContentCopyRoundedIcon fontSize="small" />} onClick={() => copy(formattedPath, 'Path')} />
      </div>

      <dl className="je-details-meta">
        {count && (
          <div>
            <dt>Size</dt>
            <dd>{count}</dd>
          </div>
        )}
        {type === 'string' && (
          <div>
            <dt>Length</dt>
            <dd>{pluralize(value.length, 'character')}</dd>
          </div>
        )}
        <div>
          <dt>Depth</dt>
          <dd>{path.length}</dd>
        </div>
        <div>
          <dt>JSON</dt>
          <dd>{formatBytes(serialized.size)}</dd>
        </div>
      </dl>

      {smart && (
        <div className="je-smart">
          <span className="je-smart-label">{smart.label}</span>
          {smart.kind === 'url' && (
            <a href={smart.url} target="_blank" rel="noopener noreferrer nofollow">
              Open link <OpenInNewRoundedIcon fontSize="inherit" />
            </a>
          )}
          {smart.kind === 'date' && <span>{smart.text}</span>}
          {smart.kind === 'color' && (
            <span className="je-smart-color">
              <span className="je-swatch" style={{ background: smart.color }} /> {smart.color}
            </span>
          )}
          {smart.kind === 'image' && <img className="je-smart-image" src={smart.url} alt="Preview of the data URL" />}
        </div>
      )}

      {imprecise && (
        <p className="je-details-note">
          {display.exact
            ? `This integer exceeds JavaScript's safe range (±2^53). The graph and tree show it rounded to ${value}; the exact value is below.`
            : `This integer exceeds JavaScript's safe range (±2^53), so it is shown rounded.`}
        </p>
      )}

      {tabular && (
        <div className="je-segmented je-details-tabs" role="group" aria-label="Value view">
          <button type="button" aria-pressed={!showTable} onClick={() => setTab('json')}>
            <DataObjectRoundedIcon fontSize="inherit" /> JSON
          </button>
          <button type="button" aria-pressed={showTable} onClick={() => setTab('table')}>
            <TableChartRoundedIcon fontSize="inherit" /> Table
          </button>
        </div>
      )}

      <div className={`je-details-value${showTable ? ' is-table' : ''}`} tabIndex={0} role="region" aria-label={showTable ? 'Value as a table' : 'Value'}>
        {showTable ? (
          <DataTable value={value} onOpenRow={(key) => onSelectPath([...path, key])} />
        ) : type === 'string' && value.length > 60 ? (
          <pre className="je-code is-text">{value}</pre>
        ) : (
          <JsonHighlight text={display.text} />
        )}
      </div>

      <footer className="je-details-actions">
        <button type="button" className="je-button" onClick={() => copy(display.text, 'Value')}>
          <ContentCopyRoundedIcon fontSize="small" /> Copy value
        </button>
        {onConvert && (
          <button type="button" className="je-button" onClick={() => onConvert(path)}>
            <TransformRoundedIcon fontSize="small" /> Convert…
          </button>
        )}
      </footer>
    </aside>
  );
}
