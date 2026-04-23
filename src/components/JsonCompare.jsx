import { DiffEditor } from '@monaco-editor/react';
import { useState, useRef, useCallback, useEffect } from 'react';

const defaultJson2 = `{
  "catalog": {
    "storeName": "TechStuff Online",
    "lastUpdated": "2025-06-01T10:00:00Z",
    "currency": "EUR",
    "products": [
      {
        "productId": "TS-1001",
        "name": "Wireless Mouse Pro",
        "category": "Accessories",
        "price": 39.99,
        "available": true,
        "tags": ["wireless", "Bluetooth", "mouse", "ergonomic"],
        "specs": {
          "color": "silver",
          "battery": "Rechargeable",
          "warranty": "2 years"
        },
        "ratings": {
          "average": 4.5,
          "reviews": 210
        }
      },
      {
        "productId": "TS-1003",
        "name": "USB-C Hub",
        "category": "Accessories",
        "price": 49.99,
        "available": true,
        "tags": ["USB-C", "hub", "adapter"],
        "specs": {
          "ports": 7,
          "color": "gray",
          "warranty": "1 year"
        },
        "ratings": {
          "average": 4.3,
          "reviews": 89
        }
      }
    ],
    "promotions": {
      "active": false,
      "details": {
        "type": "clearance",
        "discountPercent": 25,
        "validUntil": "2025-07-15"
      }
    }
  }
}
`;

function computeDiffStats(original, modified) {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const maxLen = Math.max(origLines.length, modLines.length);

  let additions = 0;
  let deletions = 0;

  // Simple line-by-line comparison
  for (let i = 0; i < maxLen; i++) {
    const origLine = i < origLines.length ? origLines[i] : undefined;
    const modLine = i < modLines.length ? modLines[i] : undefined;

    if (origLine === undefined && modLine !== undefined) {
      additions++;
    } else if (origLine !== undefined && modLine === undefined) {
      deletions++;
    } else if (origLine !== modLine) {
      additions++;
      deletions++;
    }
  }

  const isIdentical = original.trim() === modified.trim();
  return { additions, deletions, isIdentical };
}

export function JsonCompare({ initialJson1 }) {
  const [json1, setJson1] = useState(initialJson1 || '{}');
  const [json2, setJson2] = useState(defaultJson2);
  const [diffStats, setDiffStats] = useState({ additions: 0, deletions: 0, isIdentical: false });
  const diffEditorRef = useRef(null);

  // Keep json1 in sync when user changes it in the Editor tab
  useEffect(() => {
    if (initialJson1) {
      setJson1(initialJson1);
    }
  }, [initialJson1]);

  // Recompute diff stats whenever json1 or json2 changes
  useEffect(() => {
    setDiffStats(computeDiffStats(json1, json2));
  }, [json1, json2]);

  const handleEditorDidMount = useCallback((editor) => {
    diffEditorRef.current = editor;

    // Listen for changes on the original (left) editor
    const origEditor = editor.getOriginalEditor();
    const modEditor = editor.getModifiedEditor();

    origEditor.onDidChangeModelContent(() => {
      setJson1(origEditor.getValue());
    });

    modEditor.onDidChangeModelContent(() => {
      setJson2(modEditor.getValue());
    });
  }, []);

  const handleSyncJson2FromJson1 = useCallback(() => {
    setJson2(json1);
    if (diffEditorRef.current) {
      const modEditor = diffEditorRef.current.getModifiedEditor();
      modEditor.setValue(json1);
    }
  }, [json1]);

  const handleSwap = useCallback(() => {
    const newJson1 = json2;
    const newJson2 = json1;
    setJson1(newJson1);
    setJson2(newJson2);
    if (diffEditorRef.current) {
      const origEditor = diffEditorRef.current.getOriginalEditor();
      const modEditor = diffEditorRef.current.getModifiedEditor();
      origEditor.setValue(newJson1);
      modEditor.setValue(newJson2);
    }
  }, [json1, json2]);

  const handleFormat = useCallback(() => {
    try {
      const formatted1 = JSON.stringify(JSON.parse(json1), null, 2);
      setJson1(formatted1);
      if (diffEditorRef.current) {
        diffEditorRef.current.getOriginalEditor().setValue(formatted1);
      }
    } catch {
      // skip if invalid
    }

    try {
      const formatted2 = JSON.stringify(JSON.parse(json2), null, 2);
      setJson2(formatted2);
      if (diffEditorRef.current) {
        diffEditorRef.current.getModifiedEditor().setValue(formatted2);
      }
    } catch {
      // skip if invalid
    }
  }, [json1, json2]);

  const handleUpload = useCallback((side) => (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      try {
        // Validate and pretty-print
        const parsed = JSON.parse(text);
        const formatted = JSON.stringify(parsed, null, 2);
        if (side === 'original') {
          setJson1(formatted);
          if (diffEditorRef.current) {
            diffEditorRef.current.getOriginalEditor().setValue(formatted);
          }
        } else {
          setJson2(formatted);
          if (diffEditorRef.current) {
            diffEditorRef.current.getModifiedEditor().setValue(formatted);
          }
        }
      } catch {
        // If invalid JSON, still load as text
        if (side === 'original') {
          setJson1(text);
          if (diffEditorRef.current) {
            diffEditorRef.current.getOriginalEditor().setValue(text);
          }
        } else {
          setJson2(text);
          if (diffEditorRef.current) {
            diffEditorRef.current.getModifiedEditor().setValue(text);
          }
        }
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', background: '#0d1117' }}>
      {/* Toolbar */}
      <div className="compare-toolbar">
        <div className="toolbar-group">
          <button className="compare-btn primary" onClick={handleSyncJson2FromJson1} title="Copy JSON 1 content into JSON 2">
            Sync Json 1 → Json 2
          </button>
          <button className="compare-btn accent" onClick={handleSwap} title="Swap JSON 1 and JSON 2">
            ⇄ Swap
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button className="compare-btn" onClick={handleFormat} title="Pretty-print both sides">
            ✨ Format Both
          </button>

          <label className="compare-upload-label" title="Upload a file into JSON 1 (left)">
            📁 Upload JSON 1
            <input
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleUpload('original')}
            />
          </label>

          <label className="compare-upload-label" title="Upload a file into JSON 2 (right)">
            📁 Upload JSON 2
            <input
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleUpload('modified')}
            />
          </label>
        </div>

        {/* Diff stats */}
        <div className="diff-stats">
          {diffStats.isIdentical ? (
            <span className="diff-stat identical">✓ Identical</span>
          ) : (
            <>
              <span className="diff-stat additions">+{diffStats.additions} additions</span>
              <span className="diff-stat deletions">−{diffStats.deletions} deletions</span>
            </>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div className="compare-header">
        <div className="compare-header-label">JSON 1 — Original</div>
        <div className="compare-header-label">JSON 2 — Modified</div>
      </div>

      {/* Diff Editor */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <DiffEditor
          height="100%"
          language="json"
          original={json1}
          modified={json2}
          theme="vs-dark"
          onMount={handleEditorDidMount}
          options={{
            fontSize: 14,
            fontFamily: 'monospace',
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            renderSideBySide: true,
            originalEditable: true,
            readOnly: false,
            formatOnPaste: true,
            formatOnType: true,
            renderIndicators: true,
            enableSplitViewResizing: true,
          }}
        />
      </div>
    </div>
  );
}
