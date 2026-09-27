import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import Dialog from '@mui/material/Dialog';
import { useCallback, useEffect, useRef, useState } from 'react';

const TIMEOUT_MS = 30_000;

export function UrlDialog({ open, onClose, onSubmit }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(null);

  // Closing (or unmounting) abandons a request that is still running.
  const cancelRequest = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);
  useEffect(() => cancelRequest, [cancelRequest]);

  const handleClose = () => {
    cancelRequest();
    setLoading(false);
    setError('');
    onClose();
  };

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
    cancelRequest();
    const controller = new AbortController();
    requestRef.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);
    setLoading(true);
    setError('');
    try {
      await onSubmit(parsed.toString(), { signal: controller.signal });
      if (requestRef.current !== controller) return;
      requestRef.current = null;
      setUrl('');
      setLoading(false);
      onClose();
    } catch (problem) {
      if (requestRef.current !== controller) return;
      requestRef.current = null;
      setLoading(false);
      setError(timedOut ? `The server did not respond within ${TIMEOUT_MS / 1000} seconds.` : problem.message);
    } finally {
      clearTimeout(timer);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth aria-labelledby="je-url-title">
      <form className="je-dialog" onSubmit={handleSubmit}>
        <div className="je-dialog-header">
          <h2 id="je-url-title">Load JSON from a URL</h2>
          <button type="button" className="je-icon-btn" aria-label="Close" onClick={handleClose}>
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
          <button type="button" className="je-button" onClick={handleClose}>
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
