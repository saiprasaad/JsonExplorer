import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import FormatAlignLeftRoundedIcon from '@mui/icons-material/FormatAlignLeftRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import SortByAlphaRoundedIcon from '@mui/icons-material/SortByAlphaRounded';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import { DiffEditor } from '@monaco-editor/react';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { defineMonacoThemes, EDITOR_OPTIONS } from '../theme';
import { diffJson } from '../utils/diff';
import { readFileAsText } from '../utils/files';
import { findPathRange, formatJson, parseJson, sortJsonKeys } from '../utils/json';
import { useNotify } from './Notifier';
import { StructuralDiffPanel } from './StructuralDiffPanel';
import { ToolButton } from './ToolButton';

const EXACT = { exact: true };

function applyText(editor, text) {
  const model = editor.getModel();
  editor.pushUndoStop();
  editor.executeEdits('json-explorer', [{ range: model.getFullModelRange(), text, forceMoveMarkers: true }]);
  editor.pushUndoStop();
}

function describeSide(result) {
  if (result.ok) return null;
  if (result.empty) return 'empty';
  return `line ${result.error.line}: ${result.error.message}`;
}

function SideLabel({ title, name, result, onUpload }) {
  const problem = describeSide(result);
  return (
    <div className="je-compare-label">
      <span className="je-compare-label-title">{title}</span>
      <span className="je-compare-label-name" title={name}>
        {name}
      </span>
      {result.ok ? (
        <span className="je-compare-valid" title="Valid JSON">
          <CheckCircleRoundedIcon fontSize="inherit" />
        </span>
      ) : (
        <span className="je-compare-invalid" title={problem}>
          <ErrorRoundedIcon fontSize="inherit" /> {problem}
        </span>
      )}
      <span className="je-toolbar-spacer" />
      <ToolButton label={`Open a file as the ${title.toLowerCase()}`} icon={<UploadFileRoundedIcon fontSize="small" />} onClick={onUpload} className="is-small" />
    </div>
  );
}

export function JsonCompare({ leftText, onLeftTextChange, onLoadLeft, rightText, onRightTextChange, leftName, themeMode, active }) {
  const notify = useNotify();
  const diffEditorRef = useRef(null);
  const monacoRef = useRef(null);
  const leftInputRef = useRef(null);
  const rightInputRef = useRef(null);
  const hostRef = useRef(null);
  const [initialText] = useState(() => ({ left: leftText, right: rightText }));
  const [preferSideBySide, setSideBySide] = usePersistentState('compareSideBySide', true);
  // Phones have no room for two columns, so the diff is always inline there.
  const narrow = useMediaQuery('(max-width: 760px)', { noSsr: true });
  const sideBySide = preferSideBySide && !narrow;
  const [hideUnchanged, setHideUnchanged] = usePersistentState('compareHideUnchanged', false);
  const [panelOpen, setPanelOpen] = usePersistentState('compareStructuralOpen', true);
  const [rightName, setRightName] = usePersistentState('compareFileName', null);
  const [lineChanges, setLineChanges] = useState(null);
  const [changeIndex, setChangeIndex] = useState(-1);
  // Exact parses keep integers beyond 2^53 distinct, so the structural diff can tell them apart.
  const [parsed, setParsed] = useState(() => ({ left: parseJson(leftText, EXACT), right: parseJson(rightText, EXACT) }));

  const latest = useRef({});
  latest.current = { onLeftTextChange, onRightTextChange, leftText, rightText };

  // Mirror outside edits (e.g. from the main editor) into the diff models without breaking undo.
  const syncSide = useCallback((side, text) => {
    const diffEditor = diffEditorRef.current;
    if (!diffEditor) return;
    const editor = side === 'left' ? diffEditor.getOriginalEditor() : diffEditor.getModifiedEditor();
    const model = editor.getModel();
    if (model && model.getValue() !== text) applyText(editor, text);
  }, []);

  useEffect(() => {
    if (active) syncSide('left', leftText);
  }, [active, leftText, syncSide]);
  useEffect(() => {
    if (active) syncSide('right', rightText);
  }, [active, rightText, syncSide]);

  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => setParsed({ left: parseJson(leftText, EXACT), right: parseJson(rightText, EXACT) }), 300);
    return () => clearTimeout(timer);
  }, [active, leftText, rightText]);

  const structural = useMemo(() => {
    if (!parsed.left.ok || !parsed.right.ok) {
      return { status: 'invalid', leftError: describeSide(parsed.left), rightError: describeSide(parsed.right) };
    }
    try {
      return { status: 'ready', result: diffJson(parsed.left.value, parsed.right.value, { limit: 1000 }) };
    } catch (error) {
      return { status: 'invalid', leftError: error instanceof RangeError ? 'too deeply nested to compare' : error.message };
    }
  }, [parsed]);

  const handleMount = useCallback((editor, monaco) => {
    diffEditorRef.current = editor;
    monacoRef.current = monaco;
    const original = editor.getOriginalEditor();
    const modified = editor.getModifiedEditor();
    original.onDidChangeModelContent(() => latest.current.onLeftTextChange(original.getValue()));
    modified.onDidChangeModelContent(() => latest.current.onRightTextChange(modified.getValue()));
    editor.onDidUpdateDiff(() => {
      setLineChanges(editor.getLineChanges() || []);
      setChangeIndex(-1);
    });
    // Apply any edits that arrived while Monaco was still loading.
    syncSide('left', latest.current.leftText);
    syncSide('right', latest.current.rightText);
  }, [syncSide]);

  const stats = useMemo(() => {
    if (!lineChanges) return null;
    let additions = 0;
    let deletions = 0;
    lineChanges.forEach((change) => {
      if (change.modifiedEndLineNumber > 0) additions += change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
      if (change.originalEndLineNumber > 0) deletions += change.originalEndLineNumber - change.originalStartLineNumber + 1;
    });
    return { additions, deletions, changes: lineChanges.length };
  }, [lineChanges]);

  const goToChange = (step) => {
    const editor = diffEditorRef.current;
    if (!editor || !lineChanges?.length) return;
    const next = changeIndex < 0 ? (step > 0 ? 0 : lineChanges.length - 1) : (changeIndex + step + lineChanges.length) % lineChanges.length;
    setChangeIndex(next);
    const change = lineChanges[next];
    const modified = editor.getModifiedEditor();
    const line = Math.max(1, change.modifiedStartLineNumber);
    modified.revealLineInCenter(line);
    modified.setPosition({ lineNumber: line, column: 1 });
    modified.focus();
  };

  const transformBoth = (label, operation) => {
    const results = [];
    [
      ['left', leftText, onLeftTextChange],
      ['right', rightText, onRightTextChange],
    ].forEach(([side, text, update]) => {
      try {
        const next = operation(text);
        if (next !== text) update(next);
      } catch {
        results.push(side === 'left' ? 'original' : 'modified');
      }
    });
    if (results.length) notify(`Could not ${label} the ${results.join(' and ')} side — it is not valid JSON.`, 'warning');
  };

  const handleSwap = () => {
    onLoadLeft(rightText, { fileName: rightName });
    onRightTextChange(leftText);
    setRightName(leftName);
  };

  const handleCopyLeft = () => {
    onRightTextChange(leftText);
    setRightName(leftName);
  };

  const loadFile = async (side, file) => {
    if (!file) return;
    try {
      const content = await readFileAsText(file);
      if (side === 'left') onLoadLeft(content, { fileName: file.name });
      else {
        onRightTextChange(content);
        setRightName(file.name);
      }
      notify(`Opened ${file.name} as the ${side === 'left' ? 'original' : 'modified'} document.`, 'success');
    } catch (error) {
      notify(`Could not read ${file.name}: ${error.message}`, 'error');
    }
  };

  const handleFileInput = (side) => (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    loadFile(side, file);
  };

  const handleDrop = (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = hostRef.current.getBoundingClientRect();
    const side = sideBySide && event.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
    loadFile(side, event.dataTransfer.files?.[0]);
  };

  const revealChange = (change) => {
    const editor = diffEditorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const reveal = (sideEditor, text, path, fallbackPath) => {
      const range = findPathRange(text, path ?? fallbackPath);
      const model = sideEditor.getModel();
      if (!range || !model) return;
      const start = model.getPositionAt(range.keyOffset ?? range.offset);
      const end = model.getPositionAt(range.offset + range.length);
      sideEditor.setSelection(new monaco.Selection(start.lineNumber, start.column, start.lineNumber, start.column));
      sideEditor.revealRangeInCenterIfOutsideViewport(new monaco.Range(start.lineNumber, 1, end.lineNumber, 1));
      const decorations = sideEditor.createDecorationsCollection([
        { range: new monaco.Range(start.lineNumber, 1, end.lineNumber, 1), options: { isWholeLine: true, className: 'je-reveal-line' } },
      ]);
      setTimeout(() => decorations.clear(), 1800);
    };
    const parentOf = (path) => (path ? path.slice(0, -1) : null);
    reveal(editor.getOriginalEditor(), leftText, change.leftPath, parentOf(change.rightPath));
    reveal(editor.getModifiedEditor(), rightText, change.rightPath, parentOf(change.leftPath));
  };

  const identical = stats && stats.changes === 0;

  return (
    <div className="je-compare">
      <div className="je-toolbar je-compare-toolbar" role="toolbar" aria-label="Compare actions">
        <ToolButton label="Swap sides" icon={<SwapHorizRoundedIcon fontSize="small" />} onClick={handleSwap}>
          <span>Swap</span>
        </ToolButton>
        <ToolButton label="Copy the original into the modified side" icon={<ArrowForwardRoundedIcon fontSize="small" />} onClick={handleCopyLeft}>
          <span>Copy left → right</span>
        </ToolButton>
        <span className="je-toolbar-divider" />
        <ToolButton label="Format both sides" icon={<FormatAlignLeftRoundedIcon fontSize="small" />} onClick={() => transformBoth('format', (text) => formatJson(text))}>
          <span>Format</span>
        </ToolButton>
        <ToolButton
          label="Sort keys on both sides so key order does not show up as a difference"
          icon={<SortByAlphaRoundedIcon fontSize="small" />}
          onClick={() => transformBoth('sort', (text) => sortJsonKeys(text))}
        >
          <span>Sort keys</span>
        </ToolButton>
        <span className="je-toolbar-divider" />
        {!narrow && (
          <div className="je-segmented" role="group" aria-label="Diff layout">
            <button type="button" aria-pressed={sideBySide} onClick={() => setSideBySide(true)}>
              Side by side
            </button>
            <button type="button" aria-pressed={!sideBySide} onClick={() => setSideBySide(false)}>
              Inline
            </button>
          </div>
        )}
        <ToolButton
          label={hideUnchanged ? 'Show unchanged lines' : 'Hide unchanged lines'}
          icon={<VisibilityOffRoundedIcon fontSize="small" />}
          active={hideUnchanged}
          onClick={() => setHideUnchanged((current) => !current)}
        />
        <span className="je-toolbar-divider" />
        <ToolButton label="Previous change" icon={<KeyboardArrowUpRoundedIcon fontSize="small" />} onClick={() => goToChange(-1)} disabled={!lineChanges?.length} />
        <ToolButton label="Next change" icon={<KeyboardArrowDownRoundedIcon fontSize="small" />} onClick={() => goToChange(1)} disabled={!lineChanges?.length} />
        {stats && stats.changes > 0 && (
          <span className="je-compare-position">
            {changeIndex >= 0 ? `Change ${changeIndex + 1} of ${stats.changes}` : `${stats.changes} change${stats.changes === 1 ? '' : 's'}`}
          </span>
        )}
        <span className="je-toolbar-spacer" />
        {stats && (
          <span className="je-compare-stats" aria-live="polite">
            {identical ? (
              <span className="je-stat is-identical">
                <CheckCircleRoundedIcon fontSize="inherit" /> Identical text
              </span>
            ) : (
              <>
                <span className="je-stat is-added" title="Added lines">
                  +{stats.additions}
                </span>
                <span className="je-stat is-removed" title="Removed lines">
                  −{stats.deletions}
                </span>
              </>
            )}
          </span>
        )}
      </div>

      {sideBySide ? (
        <div className="je-compare-labels">
          <SideLabel title="Original" name={leftName || 'Editor document'} result={parsed.left} onUpload={() => leftInputRef.current?.click()} />
          <SideLabel title="Modified" name={rightName || 'Comparison document'} result={parsed.right} onUpload={() => rightInputRef.current?.click()} />
        </div>
      ) : (
        <div className="je-compare-labels is-inline">
          <SideLabel title="Original" name={leftName || 'Editor document'} result={parsed.left} onUpload={() => leftInputRef.current?.click()} />
          <ArrowForwardRoundedIcon fontSize="small" className="je-compare-inline-arrow" />
          <SideLabel title="Modified" name={rightName || 'Comparison document'} result={parsed.right} onUpload={() => rightInputRef.current?.click()} />
        </div>
      )}
      <input ref={leftInputRef} type="file" hidden accept=".json,.geojson,.jsonc,.txt,application/json,text/plain" onChange={handleFileInput('left')} />
      <input ref={rightInputRef} type="file" hidden accept=".json,.geojson,.jsonc,.txt,application/json,text/plain" onChange={handleFileInput('right')} />

      <div ref={hostRef} className="je-compare-editor" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <DiffEditor
          language="json"
          original={initialText.left}
          modified={initialText.right}
          theme={themeMode === 'dark' ? 'je-dark' : 'je-light'}
          beforeMount={defineMonacoThemes}
          onMount={handleMount}
          loading={<div className="je-editor-loading">Loading diff editor…</div>}
          options={{
            ...EDITOR_OPTIONS,
            originalEditable: true,
            readOnly: false,
            originalAriaLabel: 'Original JSON',
            modifiedAriaLabel: 'Modified JSON',
            renderSideBySide: sideBySide,
            useInlineViewWhenSpaceIsLimited: true,
            hideUnchangedRegions: { enabled: hideUnchanged },
            enableSplitViewResizing: true,
            renderIndicators: true,
            ignoreTrimWhitespace: false,
            // Monaco 0.52's gutter menu can throw "Illegal value for lineNumber" when a pane shrinks
            // before the diff is recomputed; the margin revert arrows remain available.
            renderGutterMenu: false,
          }}
        />
      </div>

      <StructuralDiffPanel state={structural} open={panelOpen} onToggle={() => setPanelOpen((current) => !current)} onReveal={revealChange} />
    </div>
  );
}
