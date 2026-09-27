import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import Dialog from '@mui/material/Dialog';
import { useMemo, useState } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { CONVERTERS } from '../utils/convert';
import { copyText, downloadText } from '../utils/files';
import { useNotify } from './Notifier';

const PREVIEW_LIMIT = 100_000;

function typeNameFrom(label) {
  const name = String(label || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  return /^[A-Za-z]/.test(name) ? name : 'Root';
}

/** Converts a value to TypeScript, JSON Schema, YAML or CSV with a live preview. */
export function ConvertDialog({ target, onClose }) {
  const notify = useNotify();
  const [format, setFormat] = usePersistentState('convertFormat', 'typescript', {
    validate: (candidate) => CONVERTERS.some((converter) => converter.id === candidate),
  });
  const [typeName, setTypeName] = useState(() => typeNameFrom(target?.name));
  const converter = CONVERTERS.find((candidate) => candidate.id === format);

  const result = useMemo(() => {
    if (!target) return { text: '' };
    try {
      return { text: converter.convert(target.value, typeName.trim() || 'Root') };
    } catch (error) {
      return { error: error instanceof RangeError ? 'The value is nested too deeply to convert.' : error.message };
    }
  }, [converter, target, typeName]);

  const fileBase = (target?.name || 'data').replace(/\.[a-z0-9]+$/i, '') || 'data';
  const preview = result.text && result.text.length > PREVIEW_LIMIT ? result.text.slice(0, PREVIEW_LIMIT) : result.text;

  const handleCopy = async () => {
    const copied = await copyText(result.text);
    notify(copied ? `${converter.label} copied to the clipboard.` : 'Copy failed.', copied ? 'success' : 'error');
  };

  return (
    <Dialog open={Boolean(target)} onClose={onClose} maxWidth="md" fullWidth aria-labelledby="je-convert-title">
      {target && (
        <div className="je-dialog je-convert">
          <div className="je-dialog-header">
            <h2 id="je-convert-title">Convert JSON</h2>
            <button type="button" className="je-icon-btn" aria-label="Close" onClick={onClose}>
              <CloseRoundedIcon fontSize="small" />
            </button>
          </div>

          <div className="je-convert-options">
            <div className="je-segmented" role="group" aria-label="Output format">
              {CONVERTERS.map((candidate) => (
                <button key={candidate.id} type="button" aria-pressed={candidate.id === format} onClick={() => setFormat(candidate.id)}>
                  {candidate.label}
                </button>
              ))}
            </div>
            {(format === 'typescript' || format === 'schema') && (
              <label className="je-convert-name">
                <span>{format === 'typescript' ? 'Root type' : 'Title'}</span>
                <input className="je-input" value={typeName} onChange={(event) => setTypeName(event.target.value)} spellCheck={false} />
              </label>
            )}
          </div>

          <p className="je-dialog-text">
            Source: <code>{target.label}</code>
          </p>

          {result.error ? (
            <p className="je-convert-error" role="alert">
              {result.error}
            </p>
          ) : (
            <>
              <pre className="je-code je-convert-output" tabIndex={0} aria-label={`${converter.label} output`}>
                {preview}
              </pre>
              {preview !== result.text && (
                <p className="je-code-note">
                  Preview shows the first {PREVIEW_LIMIT.toLocaleString('en-US')} characters. Copy or download to get everything.
                </p>
              )}
            </>
          )}

          <div className="je-dialog-actions">
            <button
              type="button"
              className="je-button"
              disabled={!result.text}
              onClick={() => downloadText(result.text, `${fileBase}.${converter.extension}`, converter.mime)}
            >
              <FileDownloadRoundedIcon fontSize="small" /> Download
            </button>
            <button type="button" className="je-button is-primary" disabled={!result.text} onClick={handleCopy}>
              <ContentCopyRoundedIcon fontSize="small" /> Copy {converter.label}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
