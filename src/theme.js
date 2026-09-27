import { createTheme } from '@mui/material/styles';

export const UI_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';
export const MONO_FONT = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// Keep in sync with the CSS custom properties in index.css.
export const PALETTES = {
  dark: {
    bg: '#0b1620',
    surface: '#0f1d29',
    surface2: '#142635',
    surface3: '#1b3244',
    border: '#22384a',
    text: '#e3edf5',
    textMuted: '#8aa1b4',
    textSubtle: '#5f7a8f',
    accent: '#55c6b8',
    accentContrast: '#04211d',
    danger: '#ff6b6b',
    warning: '#f2b33d',
    success: '#4cd4a0',
    key: '#82aaff',
    string: '#c3e88d',
    number: '#f78c6c',
    boolean: '#c792ea',
    null: '#7f8c98',
  },
  light: {
    bg: '#f3f6f8',
    surface: '#ffffff',
    surface2: '#f6f8fa',
    surface3: '#eaf0f4',
    border: '#d8e1e8',
    text: '#10202c',
    textMuted: '#4f6474',
    textSubtle: '#7b8e9c',
    accent: '#0b7f73',
    accentContrast: '#ffffff',
    danger: '#c62f3a',
    warning: '#a86800',
    success: '#16794c',
    key: '#1f5fbf',
    string: '#2c7a30',
    number: '#c2410c',
    boolean: '#8e3fc7',
    null: '#6b7a86',
  },
};

export function createAppTheme(mode) {
  const palette = PALETTES[mode];
  return createTheme({
    palette: {
      mode,
      primary: { main: palette.accent, contrastText: palette.accentContrast },
      error: { main: palette.danger },
      warning: { main: palette.warning },
      success: { main: palette.success },
      background: { default: palette.bg, paper: palette.surface },
      text: { primary: palette.text, secondary: palette.textMuted },
      divider: palette.border,
    },
    typography: {
      fontFamily: UI_FONT,
      fontSize: 13,
      button: { textTransform: 'none', fontWeight: 600 },
    },
    shape: { borderRadius: 8 },
    components: {
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiTooltip: {
        defaultProps: { arrow: true, enterDelay: 350, disableInteractive: true },
        styleOverrides: { tooltip: { fontSize: 12, fontWeight: 500 } },
      },
      MuiMenu: {
        styleOverrides: {
          paper: { border: `1px solid ${palette.border}`, boxShadow: '0 12px 32px rgba(0, 0, 0, 0.28)' },
        },
      },
      MuiMenuItem: { styleOverrides: { root: { fontSize: 13, minHeight: 34 } } },
      MuiDialog: {
        styleOverrides: { paper: { border: `1px solid ${palette.border}` } },
      },
      MuiIconButton: { defaultProps: { size: 'small' } },
    },
  });
}

function withoutHash(color) {
  return color.replace('#', '');
}

/** Registers `je-dark` / `je-light` Monaco themes that match the app palette. */
export function defineMonacoThemes(monaco) {
  ['dark', 'light'].forEach((mode) => {
    const palette = PALETTES[mode];
    const dark = mode === 'dark';
    monaco.editor.defineTheme(`je-${mode}`, {
      base: dark ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [
        { token: 'string.key.json', foreground: withoutHash(palette.key) },
        { token: 'string.value.json', foreground: withoutHash(palette.string) },
        { token: 'number', foreground: withoutHash(palette.number) },
        { token: 'keyword.json', foreground: withoutHash(palette.boolean) },
        { token: 'delimiter', foreground: withoutHash(palette.textMuted) },
      ],
      colors: {
        'editor.background': palette.surface,
        'editorGutter.background': palette.surface,
        'editor.lineHighlightBackground': dark ? '#14263580' : '#f1f5f880',
        'editor.lineHighlightBorder': '#00000000',
        'editorLineNumber.foreground': dark ? '#3a5366' : '#a9b7c2',
        'editorLineNumber.activeForeground': palette.textMuted,
        'editorCursor.foreground': palette.accent,
        'editor.selectionBackground': dark ? '#55c6b840' : '#0b7f7330',
        'editor.inactiveSelectionBackground': dark ? '#55c6b820' : '#0b7f7318',
        'editorIndentGuide.background1': dark ? '#1b3244' : '#e4eaef',
        'editorIndentGuide.activeBackground1': dark ? '#2e4a60' : '#c3d0db',
        'editorBracketMatch.background': dark ? '#55c6b82a' : '#0b7f7320',
        'editorBracketMatch.border': dark ? '#55c6b880' : '#0b7f7380',
        'editorWidget.background': palette.surface2,
        'editorWidget.border': palette.border,
        'input.background': palette.surface,
        'scrollbarSlider.background': dark ? '#2e4a6066' : '#c3d0db88',
        'scrollbarSlider.hoverBackground': dark ? '#2e4a60aa' : '#aebdcaaa',
        'diffEditor.insertedTextBackground': dark ? '#4cd4a026' : '#16794c1f',
        'diffEditor.removedTextBackground': dark ? '#ff6b6b2b' : '#c62f3a1f',
        'diffEditor.insertedLineBackground': dark ? '#4cd4a012' : '#16794c10',
        'diffEditor.removedLineBackground': dark ? '#ff6b6b14' : '#c62f3a10',
      },
    });
  });
}

export const EDITOR_OPTIONS = {
  fontSize: 13,
  lineHeight: 20,
  fontFamily: MONO_FONT,
  fontLigatures: false,
  minimap: { enabled: false },
  automaticLayout: true,
  scrollBeyondLastLine: false,
  tabSize: 2,
  renderLineHighlight: 'all',
  smoothScrolling: true,
  padding: { top: 10, bottom: 10 },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  fixedOverflowWidgets: true,
};
