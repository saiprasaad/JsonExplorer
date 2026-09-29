import { StyledEngineProvider, ThemeProvider } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { NotifierProvider } from '../components/Notifier';
import { createAppTheme, PALETTES } from '../theme';
import { DiffViewer } from './DiffViewer';
import { DocumentViewer } from './DocumentViewer';
import { ViewerHeader } from './ViewerHeader';

const isSide = (side) => side !== null && typeof side === 'object' && typeof side.name === 'string' && typeof side.text === 'string';

/**
 * Reads the data the CLI embedded in the page (a non-executable JSON block). Anything else,
 * including the unfilled template, yields `{ kind: 'invalid' }`.
 */
export function readPayload(doc = document) {
  const source = doc.getElementById('je-data')?.textContent ?? '';
  let payload;
  try {
    payload = JSON.parse(source);
  } catch {
    return { kind: 'invalid' };
  }
  if (payload?.kind === 'document' && typeof payload.name === 'string' && typeof payload.text === 'string') return payload;
  if (payload?.kind === 'diff' && isSide(payload.left) && isSide(payload.right)) return payload;
  return { kind: 'invalid' };
}

function InvalidPage({ themeMode, onToggleTheme }) {
  return (
    <div className="je-app je-standalone">
      <ViewerHeader title="JSON Explorer" meta="no data" themeMode={themeMode} onToggleTheme={onToggleTheme} />
      <main className="je-main">
        <div className="je-empty" role="alert">
          <div className="je-empty-card is-error">
            <h2>This page has no data to show</h2>
            <p>
              It is the viewer template, or the page was damaged. Create a page with <code>json-explorer explore &lt;file&gt;</code> or{' '}
              <code>json-explorer diff &lt;before&gt; &lt;after&gt; --html</code>.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * The offline viewer page. The theme follows the system and can be switched for the session;
 * nothing is stored, so pages opened from disk share no state with each other.
 */
export function ViewerApp({ payload }) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true });
  const [override, setOverride] = useState(null);
  const mode = override ?? (prefersDark ? 'dark' : 'light');
  const theme = useMemo(() => createAppTheme(mode), [mode]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PALETTES[mode].surface);
  }, [mode]);

  const toggleTheme = useCallback(() => setOverride(mode === 'dark' ? 'light' : 'dark'), [mode]);
  const props = { payload, themeMode: mode, onToggleTheme: toggleTheme };

  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <NotifierProvider>
          <ErrorBoundary>
            {payload.kind === 'document' ? <DocumentViewer {...props} /> : payload.kind === 'diff' ? <DiffViewer {...props} /> : <InvalidPage {...props} />}
          </ErrorBoundary>
        </NotifierProvider>
      </ThemeProvider>
    </StyledEngineProvider>
  );
}
