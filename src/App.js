import { StyledEngineProvider, ThemeProvider } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useCallback, useEffect, useMemo } from 'react';
import { NotifierProvider } from './components/Notifier';
import { readInitialDocument, Workspace } from './components/Workspace';
import { usePersistentState } from './hooks/usePersistentState';
import { createAppTheme, PALETTES } from './theme';
import { setPersistence } from './utils/storage';

const THEME_PREFERENCES = ['light', 'dark', 'system'];

export function readLaunchOptions(search = window.location.search) {
  const params = new URLSearchParams(search);
  const view = params.get('view');
  const theme = params.get('theme');
  return {
    embed: params.get('embed') === '1',
    dataUrl: params.get('dataUrl') || params.get('url') || null,
    view: ['graph', 'tree', 'compare'].includes(view) ? view : null,
    theme: THEME_PREFERENCES.includes(theme) ? theme : null,
  };
}

function App() {
  const launch = useMemo(() => {
    const options = readLaunchOptions();
    // Before anything reads storage: embeds keep no state of their own and leave the app's alone.
    setPersistence(!options.embed);
    return options;
  }, []);
  const initialDocument = useMemo(() => readInitialDocument(launch), [launch]);
  const [storedPreference, setPreference] = usePersistentState('theme', launch.embed ? 'dark' : 'system', {
    enabled: !launch.embed,
    validate: (candidate) => THEME_PREFERENCES.includes(candidate),
    override: launch.theme,
  });
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true });
  const mode = storedPreference === 'system' ? (prefersDark ? 'dark' : 'light') : storedPreference;
  const theme = useMemo(() => createAppTheme(mode), [mode]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PALETTES[mode].surface);
  }, [mode]);

  const toggleTheme = useCallback(() => setPreference(mode === 'dark' ? 'light' : 'dark'), [mode, setPreference]);

  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <NotifierProvider>
          <Workspace launch={launch} initialDocument={initialDocument} themeMode={mode} onToggleTheme={toggleTheme} />
        </NotifierProvider>
      </ThemeProvider>
    </StyledEngineProvider>
  );
}

export default App;
