import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import Dialog from '@mui/material/Dialog';
import { useState } from 'react';

export function UrlDialog({ open, onClose, onSubmit }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    let parsed;
    try {
      parsed = new URL(url.trim());
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only http(s) URLs are supported.');
    } catch (problem) {
      setError(problem.message.startsWith('Only') ? problem.message : 'Enter a valid URL, e.g. https://api.example.com/data.json');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onSubmit(parsed.toString());
      setUrl('');
      onClose();
    } catch (problem) {
      setError(problem.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="je-url-title">
      <form className="je-dialog" onSubmit={handleSubmit}>
        <div className="je-dialog-header">
          <h2 id="je-url-title">Load JSON from a URL</h2>
          <button type="button" className="je-icon-btn" aria-label="Close" onClick={onClose} disabled={loading}>
            <CloseRoundedIcon fontSize="small" />
          </button>
        </div>
        <p className="je-dialog-text">
          The URL must be publicly reachable and allow cross-origin requests (CORS). The response replaces the current
          document.
        </p>
        <input
          className="je-input"
          type="url"
          inputMode="url"
          placeholder="https://api.example.com/data.json"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          autoFocus
          aria-label="JSON URL"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'je-url-error' : undefined}
        />
        {error && (
          <p className="je-dialog-error" id="je-url-error" role="alert">
            {error}
          </p>
        )}
        <div className="je-dialog-actions">
          <button type="button" className="je-button" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button type="submit" className="je-button is-primary" disabled={loading || !url.trim()}>
            {loading ? 'Loading…' : 'Load JSON'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
