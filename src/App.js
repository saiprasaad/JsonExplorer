import { useState} from 'react';
import { JsonEditor } from './components/JsonEditor';
import { JsonViewer } from './components/JsonViewer';

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

function App() {
  const [jsonText, setJsonText] = useState(defaultJson);
  const [parsedJson, setParsedJson] = useState({});

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <JsonEditor jsonText = {jsonText} setJsonText={setJsonText} setParsedJson = {setParsedJson}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <JsonViewer inputJSON={parsedJson} />
      </div>
    </div>
  );
}

export default App;
