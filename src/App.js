import { useEffect, useMemo, useState } from 'react';
import { JsonEditor } from './components/JsonEditor';
import { JsonViewer } from './components/JsonViewer';
import { ErrorBoundary } from './components/ErrorBoundary';

const defaultJson = `{
  "catalog": {
    "storeName": "TechStuff Online",
    "lastUpdated": "2025-05-17T13:45:00Z",
    "currency": "USD",
    "products": [
      {
        "productId": "TS-1001",
        "name": "Wireless Mouse",
        "category": "Accessories",
        "price": 29.99,
        "available": true,
        "tags": ["wireless", "USB", "mouse"],
        "specs": {
          "color": "black",
          "battery": "AA",
          "warranty": "1 year"
        },
        "ratings": {
          "average": 4.2,
          "reviews": 152
        }
      },
      {
        "productId": "TS-1002",
        "name": "Mechanical Keyboard",
        "category": "Accessories",
        "price": 79.5,
        "available": false,
        "tags": ["mechanical", "keyboard", "USB-C"],
        "specs": {
          "color": "white",
          "switchType": "blue",
          "warranty": "2 years"
        },
        "ratings": {
          "average": 4.7,
          "reviews": 341
        }
      }
    ],
    "promotions": {
      "active": true,
      "details": {
        "type": "seasonal",
        "discountPercent": 15,
        "validUntil": "2025-06-30"
      }
    }
  }
}
`;

const defaultParsedJson = JSON.parse(defaultJson);
const EMBED_MESSAGE_TYPE = 'json-explorer:set-json';
const EMBED_READY_MESSAGE_TYPE = 'json-explorer:ready';

function parseIncomingJson(payload) {
  if (typeof payload === 'string') {
    return JSON.parse(payload);
  }

  if (payload === undefined) {
    throw new Error('No JSON payload was provided.');
  }

  if (payload === null || typeof payload !== 'object') {
    throw new Error('Payload must be a JSON string, object, or array.');
  }

  return payload;
}

function App() {
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const isEmbedMode = searchParams.get('embed') === '1';
  const dataUrl = searchParams.get('dataUrl');
  const [jsonText, setJsonText] = useState(defaultJson);
  const [parsedJson, setParsedJson] = useState(() => (isEmbedMode ? {} : defaultParsedJson));
  const [embedStatus, setEmbedStatus] = useState(() => {
    if (!isEmbedMode) {
      return 'ready';
    }

    return dataUrl ? 'loading' : 'waiting';
  });
  const [embedError, setEmbedError] = useState('');

  useEffect(() => {
    if (!isEmbedMode) {
      return undefined;
    }

    let isDisposed = false;

    const applyPayload = (payload) => {
      try {
        const nextJson = parseIncomingJson(payload);

        if (isDisposed) {
          return;
        }

        setParsedJson(nextJson);
        setEmbedError('');
        setEmbedStatus('ready');
      } catch (error) {
        if (isDisposed) {
          return;
        }

        setParsedJson({});
        setEmbedStatus('error');
        setEmbedError(error.message || 'Unable to load JSON payload.');
      }
    };

    const handleMessage = (event) => {
      const message = event.data;

      if (!message || typeof message !== 'object' || message.type !== EMBED_MESSAGE_TYPE) {
        return;
      }

      applyPayload(message.payload);
    };

    window.addEventListener('message', handleMessage);

    if (window.parent !== window) {
      window.parent.postMessage({ type: EMBED_READY_MESSAGE_TYPE }, '*');
    }

    if (dataUrl) {
      fetch(dataUrl)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch JSON (${response.status})`);
          }

          return response.json();
        })
        .then((data) => {
          applyPayload(data);
        })
        .catch((error) => {
          if (isDisposed) {
            return;
          }

          setParsedJson({});
          setEmbedStatus('error');
          setEmbedError(error.message || 'Unable to fetch JSON data.');
        });
    }

    return () => {
      isDisposed = true;
      window.removeEventListener('message', handleMessage);
    };
  }, [dataUrl, isEmbedMode]);

  const embedOverlayText = {
    waiting: 'Waiting for JSON from the parent page...',
    loading: 'Loading JSON payload...',
    error: embedError || 'Unable to load JSON payload.',
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: '#181818' }}>
      {!isEmbedMode && (
        <JsonEditor
          jsonText={jsonText}
          setJsonText={setJsonText}
          setParsedJson={setParsedJson}
        />
      )}
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <ErrorBoundary>
          <JsonViewer inputJSON={parsedJson} />
        </ErrorBoundary>
        {isEmbedMode && embedStatus !== 'ready' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
              background: 'rgba(24, 24, 24, 0.92)',
              color: embedStatus === 'error' ? '#ff5c8d' : '#d7e3f4',
              fontFamily: 'monospace',
              fontSize: 14,
              textAlign: 'center',
              zIndex: 50,
            }}
          >
            {embedOverlayText[embedStatus]}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
