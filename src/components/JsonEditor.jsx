import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded';
import CompressRoundedIcon from '@mui/icons-material/CompressRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import FormatAlignLeftRoundedIcon from '@mui/icons-material/FormatAlignLeftRounded';
import KeyboardDoubleArrowLeftRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowLeftRounded';
import LibraryBooksRoundedIcon from '@mui/icons-material/LibraryBooksRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import SortByAlphaRoundedIcon from '@mui/icons-material/SortByAlphaRounded';
import TransformRoundedIcon from '@mui/icons-material/TransformRounded';
import { Editor } from '@monaco-editor/react';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { SAMPLES } from '../samples';
import { defineMonacoThemes, EDITOR_OPTIONS } from '../theme';
import { copyText, downloadText, readFileAsText, suggestFileName } from '../utils/files';
import { findPathRange, formatBytes, formatJson, getPathAtOffset, minifyJson, parseJson, sortJsonKeys, utf8ByteLength } from '../utils/json';
import { MOD_KEY, SHIFT_KEY, shortcutLabel } from '../utils/platform';
import { useNotify } from './Notifier';
import { ToolButton } from './ToolButton';

const INDENT_OPTIONS = [
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
  { value: '\t', label: 'Tabs' },
];

// Monaco's CursorChangeReason.Explicit: the user clicked or navigated (not typing or an API call).
const EXPLICIT_CURSOR_CHANGE = 3;

export function JsonEditor({
  apiRef,
  text,
  onTextChange,
  fileName,
  parseResult,
  stats,
  themeMode,
  enabled,
  onLoadDocument,
  onOpenUrl,
  onConvert,
  onCursorPath,
  onCollapse,
}) {
  const notify = useNotify();
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const fileInputRef = useRef(null);
  const cursorTimerRef = useRef(null);
  const [indent, setIndent] = usePersistentState('indent', 2, { validate: (value) => [2, 4, '\t'].includes(value) });
  const [samplesAnchor, setSamplesAnchor] = useState(null);
  const [moreAnchor, setMoreAnchor] = useState(null);
  const [byteSize, setByteSize] = useState(() => utf8ByteLength(text));

  const latest = useRef({});
  latest.current = { text, indent, onCursorPath, fileName };

  useEffect(() => {
    const timer = setTimeout(() => setByteSize(utf8ByteLength(text)), 250);
    return () => clearTimeout(timer);
  }, [text]);

  /** Replaces the editor content through Monaco so the change can be undone with Ctrl/Cmd+Z. */
  const replaceText = useCallback(
    (nextText) => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model) {
        onTextChange(nextText);
        return;
      }
      editor.pushUndoStop();
      editor.executeEdits('json-explorer', [{ range: model.getFullModelRange(), text: nextText, forceMoveMarkers: true }]);
      editor.pushUndoStop();
      editor.setPosition({ lineNumber: 1, column: 1 });
      editor.revealLine(1);
    },
    [onTextChange]
  );

  const describeInvalid = useCallback((result) => {
    if (result.empty) return 'The document is empty.';
    return `${result.error.message} (line ${result.error.line}, column ${result.error.column}).`;
  }, []);

  const transform = useCallback(
    (label, operation) => {
      const current = latest.current.text;
      const result = parseJson(current);
      if (!result.ok) {
        notify(`Cannot ${label}: ${describeInvalid(result)} Try Repair.`, 'error');
        return;
      }
      try {
        const next = operation(current, latest.current.indent);
        if (next !== current) replaceText(next);
      } catch (error) {
        notify(`Cannot ${label}: ${error instanceof RangeError ? 'the document is nested too deeply.' : error.message}`, 'error');
      }
    },
    [describeInvalid, notify, replaceText]
  );

  const handleFormat = useCallback(() => transform('format', formatJson), [transform]);
  const handleMinify = useCallback(() => transform('minify', (value) => minifyJson(value)), [transform]);
  const handleSortKeys = useCallback(() => transform('sort keys', sortJsonKeys), [transform]);

  const handleRepair = useCallback(async () => {
    const current = latest.current.text;
    if (parseJson(current).ok) {
      notify('The JSON is already valid — nothing to repair.', 'info');
      return;
    }
    try {
      const { jsonrepair } = await import('jsonrepair');
      const repaired = formatJson(jsonrepair(current), latest.current.indent);
      replaceText(repaired);
      notify('JSON repaired. Press Undo to revert.', 'success');
    } catch (error) {
      notify(`Could not repair the JSON automatically: ${error.message}`, 'error');
    }
  }, [notify, replaceText]);

  const handleCopy = useCallback(async () => {
    const copied = await copyText(latest.current.text);
    notify(copied ? 'JSON copied to the clipboard.' : 'Copy failed — select the text and copy manually.', copied ? 'success' : 'error');
  }, [notify]);

  const handleDownload = useCallback(() => {
    downloadText(latest.current.text, suggestFileName(latest.current.fileName, 'data.json'));
  }, []);

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);

  const handleFileChange = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const content = await readFileAsText(file);
        onLoadDocument(content, { fileName: file.name });
        notify(`Opened ${file.name} (${formatBytes(file.size)}).`, 'success');
      } catch (error) {
        notify(`Could not read ${file.name}: ${error.message}`, 'error');
      }
    },
    [notify, onLoadDocument]
  );

  const revealPath = useCallback((path) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return false;
    const range = findPathRange(model.getValue(), path);
    if (!range) return false;

    const selectionStart = model.getPositionAt(range.keyOffset ?? range.offset);
    const selectionEnd = model.getPositionAt(
      range.keyOffset !== null ? range.keyOffset + range.keyLength : range.offset + Math.min(range.length, 200)
    );
    const valueEnd = model.getPositionAt(range.offset + range.length);
    editor.setSelection(new monaco.Selection(selectionStart.lineNumber, selectionStart.column, selectionEnd.lineNumber, selectionEnd.column));
    editor.revealRangeNearTopIfOutsideViewport(new monaco.Range(selectionStart.lineNumber, 1, valueEnd.lineNumber, 1));
    const decorations = editor.createDecorationsCollection([
      { range: new monaco.Range(selectionStart.lineNumber, 1, valueEnd.lineNumber, 1), options: { isWholeLine: true, className: 'je-reveal-line' } },
    ]);
    setTimeout(() => decorations.clear(), 1800);
    editor.focus();
    return true;
  }, []);

  const jumpTo = useCallback((line, column) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setPosition({ lineNumber: line, column });
    editor.revealPositionInCenter({ lineNumber: line, column });
    editor.focus();
  }, []);

  useImperativeHandle(
    apiRef,
    () => ({
      revealPath,
      openFile: openFilePicker,
      download: handleDownload,
      format: handleFormat,
      minify: handleMinify,
      focus: () => editorRef.current?.focus(),
    }),
    [handleDownload, handleFormat, handleMinify, openFilePicker, revealPath]
  );

  const handleMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      const { KeyMod, KeyCode } = monaco;
      editor.addAction({ id: 'je-format', label: 'Format JSON', keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF], run: () => handleFormat() });
      editor.addAction({ id: 'je-minify', label: 'Minify JSON', keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyM], run: () => handleMinify() });
      editor.addAction({ id: 'je-sort', label: 'Sort keys', run: () => handleSortKeys() });
      editor.addAction({ id: 'je-repair', label: 'Repair JSON', run: () => handleRepair() });
      editor.addAction({ id: 'je-save', label: 'Download JSON', keybindings: [KeyMod.CtrlCmd | KeyCode.KeyS], run: () => handleDownload() });
      editor.addAction({ id: 'je-open', label: 'Open file…', keybindings: [KeyMod.CtrlCmd | KeyCode.KeyO], run: () => openFilePicker() });

      editor.onDidChangeCursorPosition((event) => {
        if (event.reason !== EXPLICIT_CURSOR_CHANGE || event.source === 'api') return;
        clearTimeout(cursorTimerRef.current);
        cursorTimerRef.current = setTimeout(() => {
          const model = editor.getModel();
          if (!model || !latest.current.onCursorPath) return;
          const path = getPathAtOffset(model.getValue(), model.getOffsetAt(editor.getPosition()));
          if (path) latest.current.onCursorPath(path);
        }, 150);
      });
    },
    [handleDownload, handleFormat, handleMinify, handleRepair, handleSortKeys, openFilePicker]
  );

  useEffect(() => () => clearTimeout(cursorTimerRef.current), []);

  const loadSample = (sample) => {
    setSamplesAnchor(null);
    onLoadDocument(sample.build(), { fileName: `${sample.id}.json` });
  };

  const invalid = !parseResult.ok && !parseResult.empty;

  return (
    <div className="je-editor-panel-inner">
      <div className="je-toolbar" role="toolbar" aria-label="Editor actions">
        <ToolButton label="Format" shortcut={shortcutLabel(MOD_KEY, SHIFT_KEY, 'F')} icon={<FormatAlignLeftRoundedIcon fontSize="small" />} onClick={handleFormat} disabled={!enabled} />
        <ToolButton label="Minify" shortcut={shortcutLabel(MOD_KEY, SHIFT_KEY, 'M')} icon={<CompressRoundedIcon fontSize="small" />} onClick={handleMinify} disabled={!enabled} />
        <ToolButton label="Sort keys A→Z" icon={<SortByAlphaRoundedIcon fontSize="small" />} onClick={handleSortKeys} disabled={!enabled} />
        <ToolButton
          label={invalid ? 'Repair JSON (fix quotes, commas, comments…)' : 'Repair JSON'}
          icon={<AutoFixHighRoundedIcon fontSize="small" />}
          onClick={handleRepair}
          className={invalid ? 'is-attention' : ''}
          disabled={!enabled}
        />
        <span className="je-toolbar-divider" />
        <ToolButton label="Open file" shortcut={shortcutLabel(MOD_KEY, 'O')} icon={<FolderOpenRoundedIcon fontSize="small" />} onClick={openFilePicker} disabled={!enabled} />
        <ToolButton label="Download" shortcut={shortcutLabel(MOD_KEY, 'S')} icon={<FileDownloadRoundedIcon fontSize="small" />} onClick={handleDownload} />
        <ToolButton label="Copy JSON" icon={<ContentCopyRoundedIcon fontSize="small" />} onClick={handleCopy} />
        <span className="je-toolbar-spacer" />
        <ToolButton
          label="Load a sample"
          icon={<LibraryBooksRoundedIcon fontSize="small" />}
          onClick={(event) => setSamplesAnchor(event.currentTarget)}
          aria-haspopup="menu"
          disabled={!enabled}
        />
        <ToolButton label="More actions" icon={<MoreVertRoundedIcon fontSize="small" />} onClick={(event) => setMoreAnchor(event.currentTarget)} aria-haspopup="menu" />
        {onCollapse && <ToolButton label="Hide editor" icon={<KeyboardDoubleArrowLeftRoundedIcon fontSize="small" />} onClick={onCollapse} />}
      </div>

      <Menu anchorEl={samplesAnchor} open={Boolean(samplesAnchor)} onClose={() => setSamplesAnchor(null)}>
        <ListSubheader className="je-menu-subheader">Samples</ListSubheader>
        {SAMPLES.map((sample) => (
          <MenuItem key={sample.id} onClick={() => loadSample(sample)}>
            <ListItemText primary={sample.name} secondary={sample.description} />
          </MenuItem>
        ))}
      </Menu>

      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
        <MenuItem
          onClick={() => {
            setMoreAnchor(null);
            onOpenUrl();
          }}
          disabled={!enabled}
        >
          <ListItemIcon>
            <CloudDownloadRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Load from URL…</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMoreAnchor(null);
            onConvert();
          }}
        >
          <ListItemIcon>
            <TransformRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Convert…" secondary="TypeScript, JSON Schema, YAML, CSV" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMoreAnchor(null);
            onLoadDocument('', { fileName: null });
          }}
          disabled={!enabled}
        >
          <ListItemIcon>
            <DeleteOutlineRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Clear editor</ListItemText>
        </MenuItem>
        <Divider />
        <ListSubheader className="je-menu-subheader">Indentation</ListSubheader>
        {INDENT_OPTIONS.map((option) => (
          <MenuItem
            key={option.label}
            selected={indent === option.value}
            onClick={() => {
              setIndent(option.value);
              setMoreAnchor(null);
            }}
          >
            <ListItemIcon>{indent === option.value && <CheckRoundedIcon fontSize="small" />}</ListItemIcon>
            <ListItemText>{option.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      <input ref={fileInputRef} type="file" accept=".json,.geojson,.jsonc,.txt,application/json,text/plain" hidden onChange={handleFileChange} />

      <div className="je-editor-host">
        <Editor
          language="json"
          value={text}
          onChange={(value) => onTextChange(value ?? '')}
          theme={themeMode === 'dark' ? 'je-dark' : 'je-light'}
          beforeMount={defineMonacoThemes}
          onMount={handleMount}
          options={{ ...EDITOR_OPTIONS, ariaLabel: 'JSON editor', readOnly: !enabled, formatOnPaste: true }}
          loading={<div className="je-editor-loading">Loading editor…</div>}
        />
      </div>

      <div className={`je-statusbar${invalid ? ' is-error' : ''}`} role="status" aria-live="polite">
        {parseResult.ok && (
          <span className="je-status-item is-valid">
            <CheckCircleRoundedIcon fontSize="inherit" /> Valid JSON
          </span>
        )}
        {parseResult.empty && <span className="je-status-item">Empty document</span>}
        {invalid && (
          <>
            <button
              type="button"
              className="je-status-error"
              onClick={() => jumpTo(parseResult.error.line, parseResult.error.column)}
              title="Jump to the error"
            >
              <ErrorRoundedIcon fontSize="inherit" />
              <span className="je-status-error-text">{parseResult.error.message}</span>
              <span className="je-status-location">
                Ln {parseResult.error.line}, Col {parseResult.error.column}
              </span>
            </button>
            <button type="button" className="je-status-action" onClick={handleRepair}>
              Repair
            </button>
          </>
        )}
        <span className="je-status-spacer" />
        {stats && parseResult.ok && (
          <span className="je-status-item is-muted" title={`${stats.objects} objects · ${stats.arrays} arrays · ${stats.values} values`}>
            {stats.keys.toLocaleString('en-US')} keys · depth {stats.maxDepth}
          </span>
        )}
        <span className="je-status-item is-muted" title={fileName || 'Untitled document'}>
          {formatBytes(byteSize)}
        </span>
      </div>
    </div>
  );
}
