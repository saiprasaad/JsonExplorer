export const DEFAULT_JSON = `{
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

export const DEFAULT_COMPARE_JSON = `{
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

const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;

function buildUsers() {
  return pretty([
    {
      id: 1,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      active: true,
      roles: ['admin', 'editor'],
      address: { street: '12 Analytical Way', city: 'London', country: 'UK', geo: { lat: 51.5072, lng: -0.1276 } },
      lastLogin: '2025-09-01T08:15:00Z',
    },
    {
      id: 2,
      name: 'Alan Turing',
      email: 'alan@example.com',
      active: false,
      roles: ['viewer'],
      address: { street: '3 Bletchley Park', city: 'Milton Keynes', country: 'UK', geo: { lat: 51.9977, lng: -0.7407 } },
      lastLogin: null,
    },
    {
      id: 3,
      name: 'Grace Hopper',
      email: 'grace@example.com',
      active: true,
      roles: ['editor'],
      address: { street: '1 Compiler Ct', city: 'Arlington', country: 'US', geo: { lat: 38.8816, lng: -77.091 } },
      lastLogin: '2025-09-12T17:42:10Z',
    },
  ]);
}

function buildApiResponse() {
  return pretty({
    status: 200,
    ok: true,
    requestId: 'req_8f14e45fceea167a',
    meta: { page: 2, perPage: 3, total: 42, totalPages: 14, generatedIn: '38ms' },
    links: {
      self: 'https://api.example.com/v1/orders?page=2',
      next: 'https://api.example.com/v1/orders?page=3',
      prev: 'https://api.example.com/v1/orders?page=1',
    },
    data: [
      {
        id: 'ord_1001',
        status: 'shipped',
        total: { amount: 129.97, currency: 'USD' },
        customer: { id: 'cus_77', name: 'Priya Sharma', vip: true },
        items: [
          { sku: 'KB-01', qty: 1, price: 79.99 },
          { sku: 'MS-02', qty: 2, price: 24.99 },
        ],
        shipping: { carrier: 'UPS', tracking: '1Z999AA10123456784', eta: '2025-09-30' },
      },
      {
        id: 'ord_1002',
        status: 'processing',
        total: { amount: 15.5, currency: 'USD' },
        customer: { id: 'cus_12', name: 'Liam Chen', vip: false },
        items: [{ sku: 'CB-10', qty: 1, price: 15.5 }],
        shipping: null,
      },
      {
        id: 'ord_1003',
        status: 'cancelled',
        total: { amount: 0, currency: 'USD' },
        customer: { id: 'cus_31', name: 'Sofia Rossi', vip: false },
        items: [],
        shipping: null,
        cancellation: { reason: 'customer_request', refunded: true },
      },
    ],
    errors: [],
  });
}

function buildGeoJson() {
  return pretty({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Golden Gate Park', kind: 'park', area_km2: 4.1 },
        geometry: { type: 'Point', coordinates: [-122.4862, 37.7694] },
      },
      {
        type: 'Feature',
        properties: { name: 'Lombard Street', kind: 'street', oneWay: true },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-122.4194, 37.8021],
            [-122.4186, 37.8019],
            [-122.4179, 37.8017],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { name: 'Alcatraz Island', kind: 'island', visitors: 1400000 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-122.4245, 37.8277],
              [-122.4207, 37.8277],
              [-122.4207, 37.8252],
              [-122.4245, 37.8252],
              [-122.4245, 37.8277],
            ],
          ],
        },
      },
    ],
  });
}

function buildPackageJson() {
  return pretty({
    name: 'my-awesome-app',
    version: '2.4.1',
    private: true,
    description: 'An example package.json manifest',
    scripts: { start: 'vite', build: 'vite build', test: 'vitest run', lint: 'eslint .' },
    dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0', zod: '^3.23.8' },
    devDependencies: { vite: '^6.0.0', vitest: '^2.1.0', eslint: '^9.12.0' },
    engines: { node: '>=20' },
    browserslist: ['>0.2%', 'not dead'],
    repository: { type: 'git', url: 'https://github.com/example/my-awesome-app.git' },
  });
}

// Written as raw text so the big integer and exponent literals are preserved exactly.
const EVERY_TYPE_JSON = `{
  "string": "Hello, JSON Explorer!",
  "unicode": "Grüße 👋 こんにちは",
  "escapes": "Line one\\nLine two \\"quoted\\" \\\\ backslash",
  "emptyString": "",
  "integer": 42,
  "negative": -17,
  "float": 3.14159,
  "exponent": 6.022e23,
  "bigInteger": 12345678901234567890,
  "booleanTrue": true,
  "booleanFalse": false,
  "nothing": null,
  "emptyObject": {},
  "emptyArray": [],
  "numbers": [1, 2, 3, 5, 8, 13],
  "mixedArray": [1, "two", false, null, { "five": 5 }, [6, 7]],
  "matrix": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  "key with spaces": "keys can contain any characters",
  "dotted.key": "not a nested path",
  "nested": {
    "level1": {
      "level2": {
        "level3": {
          "level4": { "message": "deeply nested value" }
        }
      }
    }
  }
}
`;

function buildLargeDataset(count = 2000) {
  const teams = ['platform', 'payments', 'search', 'mobile', 'growth', 'infra'];
  const regions = ['us-east-1', 'eu-west-1', 'ap-south-1'];
  const records = [];
  for (let index = 0; index < count; index += 1) {
    records.push({
      id: `evt_${String(index).padStart(5, '0')}`,
      type: ['deploy', 'incident', 'alert', 'release'][index % 4],
      severity: index % 5,
      resolved: index % 3 !== 0,
      team: teams[index % teams.length],
      region: regions[index % regions.length],
      tags: [`t${index % 7}`, `g${index % 11}`],
      metrics: { latencyMs: 20 + ((index * 37) % 480), errors: (index * 13) % 9, requests: 1000 + index * 17 },
      owner: { id: `u_${index % 50}`, name: `Engineer ${index % 50}` },
    });
  }
  return pretty({
    dataset: 'operations-events',
    generatedAt: '2025-09-27T00:00:00Z',
    count,
    records,
  });
}

export const SAMPLES = [
  { id: 'catalog', name: 'Product catalog', description: 'Nested objects and arrays', build: () => DEFAULT_JSON },
  { id: 'users', name: 'User list', description: 'Array of records at the root', build: buildUsers },
  { id: 'api', name: 'API response', description: 'Paginated REST payload', build: buildApiResponse },
  { id: 'geojson', name: 'GeoJSON', description: 'Geometry with nested coordinates', build: buildGeoJson },
  { id: 'package', name: 'package.json', description: 'A typical npm manifest', build: buildPackageJson },
  { id: 'types', name: 'Every JSON type', description: 'Edge cases: unicode, big numbers, mixed arrays', build: () => EVERY_TYPE_JSON },
  { id: 'large', name: 'Large dataset', description: '2,000 records — stress test', build: () => buildLargeDataset(2000) },
];
