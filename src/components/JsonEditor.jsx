import { Editor } from '@monaco-editor/react';
import { useState, useRef, useEffect } from 'react';

export function JsonEditor({ jsonText, setJsonText, setParsedJson }) {
  const [jsonError, setJsonError] = useState('');
  const [editorWidth, setEditorWidth] = useState(400);
  const sidebarRef = useRef(null);
  const isResizing = useRef(false);
  const handleFormat = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setJsonError('');
    } catch (e) {
      setJsonError('Invalid JSON: Cannot format');
    }
  };

  useEffect(() => {
    try {
      setParsedJson(JSON.parse(jsonText));
      setJsonError('');
    } catch (e) {
      setJsonError(e.message);
      setParsedJson({});
    }
  }, [jsonText, setParsedJson]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizing.current) {
        const newWidth = Math.max(220, Math.min(e.clientX, window.innerWidth - 200));
        setEditorWidth(newWidth);
      }
    };
    const handleMouseUp = () => {
      isResizing.current = false;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div
      ref={sidebarRef}
      style={{
        width: editorWidth,
        background: '#23272e',
        color: '#fff',
        padding: 16,
        borderRight: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        minWidth: 180,
        maxWidth: 600,
        transition: 'width 0.1s'
      }}
    >
      <h3 style={{ margin: 0, marginBottom: 8, fontFamily: 'monospace' }}>JSON Editor</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button
          onClick={handleFormat}
          style={{
            fontFamily: 'monospace',
            fontSize: 13,
            padding: '4px 12px',
            borderRadius: 4,
            border: '1px solid #444',
            background: '#181c22',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          Format JSON
        </button>
      </div>
      <Editor
        height="calc(100vh - 110px)"
        defaultLanguage="json"
        value={jsonText}
        onChange={(value) => setJsonText(value || '')}
        theme="vs-dark"
        options={{
          fontSize: 14,
          fontFamily: 'monospace',
          minimap: { enabled: false },
          automaticLayout: true,
          scrollBeyondLastLine: false,
          formatOnPaste: true,
          formatOnType: true,
        }}
      />
      {jsonError && (
        <div style={{ color: '#ff5c8d', marginTop: 8, fontFamily: 'monospace', fontSize: 13 }}>
          {jsonError}
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 8,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 10,
          background: 'transparent'
        }}
        onMouseDown={() => { isResizing.current = true; }}
      />
    </div>
  );
}
