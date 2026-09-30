import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setPersistence } from '../utils/storage';
import { computeChanges } from './DiffViewer';
import { readPayload, ViewerApp } from './ViewerApp';

// eslint-disable-next-line testing-library/no-node-access
const nodeLabels = () => Array.from(document.querySelectorAll('.je-node-label')).map((element) => element.textContent);
// eslint-disable-next-line testing-library/no-node-access
const diffRows = () => Array.from(document.querySelectorAll('.je-diff-row'));
// eslint-disable-next-line testing-library/no-node-access
const rowPaths = () => diffRows().map((row) => row.querySelector('.je-diff-path').textContent);

const DOC = '{"name": "Ada", "id": 12345678901234567890, "orders": [{"total": 1.50}, {"total": 2}]}';
const documentPayload = (overrides = {}) => ({ kind: 'document', name: 'orders.json', text: DOC, dialect: 'json', view: 'graph', bytes: DOC.length, generator: 'JSON Explorer 1.0.0', ...overrides });
const diffPayload = (overrides = {}) => ({
  kind: 'diff',
  left: { name: 'before.json', text: '{"a": 1, "b": [1, 2], "gone": true, "id": 12345678901234567890, "kind": 1, "items": [{"id": 1, "q": 1}]}' },
  right: { name: 'after.json', text: '{"a": 2, "b": [1, 2, 3], "id": 12345678901234567891, "kind": "one", "items": [{"id": 0, "q": 5}, {"id": 1, "q": 2}]}' },
  ignore: [],
  arrays: 'align',
  generator: 'JSON Explorer 1.0.0',
  ...overrides,
});

beforeEach(() => {
  setPersistence(false);
  window.localStorage.clear();
});

describe('readPayload', () => {
  const docWith = (content) => {
    const doc = document.implementation.createHTMLDocument('t');
    const script = doc.createElement('script');
    script.type = 'application/json';
    script.id = 'je-data';
    script.textContent = content;
    doc.body.appendChild(script);
    return doc;
  };

  it('reads document and diff payloads', () => {
    expect(readPayload(docWith(JSON.stringify(documentPayload())))).toEqual(documentPayload());
    expect(readPayload(docWith(JSON.stringify(diffPayload())))).toEqual(diffPayload());
  });

  it('reads the page it runs in by default', () => {
    const script = document.createElement('script');
    script.type = 'application/json';
    script.id = 'je-data';
    script.textContent = JSON.stringify(documentPayload());
    document.body.appendChild(script);
    try {
      expect(readPayload()).toEqual(documentPayload());
    } finally {
      script.remove();
    }
  });

  it('treats anything else as invalid', () => {
    expect(readPayload(docWith('/*JSON_EXPLORER_DATA*/'))).toEqual({ kind: 'invalid' });
    expect(readPayload(docWith('{"kind": "document", "name": "x"}'))).toEqual({ kind: 'invalid' });
    expect(readPayload(docWith('{"kind": "diff", "left": {"name": "a", "text": "1"}, "right": null}'))).toEqual({ kind: 'invalid' });
    expect(readPayload(docWith('{"kind": "diff", "left": "a", "right": {"name": "b", "text": "2"}}'))).toEqual({ kind: 'invalid' });
    expect(readPayload(docWith('{"kind": "diff", "left": {"name": 1, "text": "1"}, "right": {"name": "b", "text": "2"}}'))).toEqual({ kind: 'invalid' });
    expect(readPayload(docWith('{"kind": "diff", "left": {"name": "a", "text": 1}, "right": {"name": "b", "text": "2"}}'))).toEqual({ kind: 'invalid' });
    expect(readPayload(docWith('{"kind": "other"}'))).toEqual({ kind: 'invalid' });
    expect(readPayload(docWith('null'))).toEqual({ kind: 'invalid' });
    expect(readPayload(document.implementation.createHTMLDocument('empty'))).toEqual({ kind: 'invalid' });
  });
});

describe('document page', () => {
  it('shows the graph with the file name, size and privacy badge', async () => {
    render(<ViewerApp payload={documentPayload()} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('orders.json');
    expect(screen.getByText(/B · 8 values · depth 3$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Offline and private/)).toHaveTextContent('Offline');
    await waitFor(() => expect(nodeLabels()).toEqual(expect.arrayContaining(['root', 'orders'])));
    expect(screen.getByRole('tab', { name: /Graph/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches views by tab, arrow keys and Alt+number', async () => {
    render(<ViewerApp payload={documentPayload({ view: 'tree' })} />);
    const tree = screen.getByRole('tab', { name: /Tree/ });
    expect(tree).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('tree')).toBeInTheDocument();
    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Graph/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Graph/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Graph/ }), { key: 'End' });
    expect(tree).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tree, { key: 'Home' });
    expect(screen.getByRole('tab', { name: /Graph/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tree, { key: 'Enter' });
    fireEvent.keyDown(window, { code: 'Digit2', key: '2', altKey: true });
    expect(tree).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: /Graph/ }));
    expect(screen.getByRole('tab', { name: /Graph/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('focuses search with "/" and Ctrl+F', async () => {
    render(<ViewerApp payload={documentPayload()} />);
    await waitFor(() => expect(nodeLabels()).toContain('root'));
    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByRole('searchbox', { name: 'Search the document' })).toHaveFocus();
    screen.getByRole('searchbox', { name: 'Search the document' }).blur();
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(screen.getByRole('searchbox', { name: 'Search the document' })).toHaveFocus();
  });

  it('opens details with exact values, closes them with Escape, and converts', async () => {
    render(<ViewerApp payload={documentPayload()} />);
    fireEvent.click(await screen.findByText('root', { selector: '.je-node-label' }));
    const details = await screen.findByRole('complementary', { name: 'Details' });
    expect(within(details).getByText('$')).toBeInTheDocument();
    fireEvent.click(within(details).getByRole('button', { name: /Convert/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'YAML' }));
    expect(within(dialog).getByLabelText('YAML output')).toHaveTextContent('id: 12345678901234567890');
    expect(within(dialog).getByLabelText('YAML output')).toHaveTextContent('total: 1.50');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Details' })).not.toBeInTheDocument());
    fireEvent.click(await screen.findByText('orders', { selector: '.je-node-label' }));
    expect(await screen.findByRole('complementary', { name: 'Details' })).toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-node-access
    fireEvent.keyDown(document.querySelector('.je-graph'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Details' })).not.toBeInTheDocument());
  });

  it('navigates with breadcrumbs and the keyboard, and closes details with its button', async () => {
    render(<ViewerApp payload={documentPayload({ bytes: undefined })} />);
    expect(screen.getByText(`${DOC.length} B · 8 values · depth 3`)).toBeInTheDocument();
    fireEvent.click(await screen.findByText('orders', { selector: '.je-node-label' }));
    const details = await screen.findByRole('complementary', { name: 'Details' });
    fireEvent.click(within(within(details).getByRole('navigation', { name: 'Path' })).getByRole('button', { name: 'root' }));
    await waitFor(() => expect(within(details).getByText('$')).toBeInTheDocument());
    fireEvent.click(within(details).getByRole('button', { name: 'Close details (Esc)' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Details' })).not.toBeInTheDocument());
    // eslint-disable-next-line testing-library/no-node-access
    fireEvent.keyDown(document.querySelector('.je-graph'), { key: 'ArrowRight' });
    expect(screen.queryByRole('complementary', { name: 'Details' })).not.toBeInTheDocument();
  });

  it('converts array items without a type name', async () => {
    render(<ViewerApp payload={documentPayload()} />);
    fireEvent.click(await screen.findByText('[0]', { selector: '.je-node-label' }));
    const details = await screen.findByRole('complementary', { name: 'Details' });
    fireEvent.click(within(details).getByRole('button', { name: /Convert/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('$.orders[0]');
  });

  it('uses the compact layout on small screens', () => {
    const original = window.matchMedia;
    window.matchMedia = (query) => ({ matches: query.includes('max-width'), media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} });
    try {
      render(<ViewerApp payload={documentPayload()} />);
      expect(screen.getByRole('tabpanel')).toHaveClass('is-compact');
    } finally {
      window.matchMedia = original;
    }
  });

  it('converts documents without big numbers from the parsed value', async () => {
    render(<ViewerApp payload={documentPayload({ text: '{"a": {"b": [1, 2]}}' })} />);
    fireEvent.click(await screen.findByText('a', { selector: '.je-node-label' }));
    const details = await screen.findByRole('complementary', { name: 'Details' });
    fireEvent.click(within(details).getByRole('button', { name: /Convert/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('$.a');
  });

  it('follows a dark system theme', () => {
    const original = window.matchMedia;
    window.matchMedia = (query) => ({ matches: query.includes('dark'), media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} });
    try {
      render(<ViewerApp payload={documentPayload()} />);
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });

  it('switches the theme for the session without storing anything', () => {
    render(<ViewerApp payload={documentPayload()} />);
    const start = document.documentElement.dataset.theme;
    fireEvent.click(screen.getByRole('button', { name: /Switch to (dark|light) theme/ }));
    expect(document.documentElement.dataset.theme).toBe(start === 'dark' ? 'light' : 'dark');
    fireEvent.click(screen.getByRole('button', { name: /Switch to (dark|light) theme/ }));
    expect(document.documentElement.dataset.theme).toBe(start);
    expect(window.localStorage.length).toBe(0);
  });

  it('explains data it cannot read', () => {
    render(<ViewerApp payload={documentPayload({ text: '{"a": ', bytes: undefined })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This page’s data could not be read');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    render(<ViewerApp payload={documentPayload({ text: '' })} />);
    expect(screen.getAllByRole('alert')[1]).toHaveTextContent(/empty|could not be read/);
  });
});

describe('diff page', () => {
  it('lists the differences with counts and shows exact values side by side', () => {
    render(<ViewerApp payload={diffPayload()} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('before.json → after.json');
    expect(screen.getByText('7 differences')).toBeInTheDocument();
    const show = screen.getByRole('group', { name: 'Show' });
    expect(within(show).getByRole('button', { name: /All 7/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(show).getByRole('button', { name: /Added 2/ })).toBeInTheDocument();
    expect(within(show).getByRole('button', { name: /Removed 1/ })).toBeInTheDocument();
    expect(within(show).getByRole('button', { name: /Changed 4/ })).toBeInTheDocument();
    const detail = screen.getByRole('region', { name: 'Selected difference' });
    expect(within(detail).getByText('$.a')).toBeInTheDocument();
    fireEvent.click(diffRows().find((row) => row.textContent.includes('$.id')));
    expect(within(detail).getByText('12345678901234567890')).toBeInTheDocument();
    expect(within(detail).getByText('12345678901234567891')).toBeInTheDocument();
  });

  it('marks type changes and shifted items, and shows missing sides', () => {
    render(<ViewerApp payload={diffPayload()} />);
    expect(diffRows().find((row) => row.textContent.includes('$.kind'))).toHaveTextContent('type changed');
    const shifted = diffRows().find((row) => row.textContent.includes('$.items[1].q'));
    expect(shifted).toHaveTextContent('was $.items[0].q');
    fireEvent.click(shifted);
    expect(screen.getByRole('region', { name: 'Selected difference' })).toHaveTextContent('was $.items[0].q');
    fireEvent.click(diffRows().find((row) => row.textContent.includes('$.gone')));
    expect(screen.getByText('Not present')).toBeInTheDocument();
  });

  it('reports items that moved, and an item that moved and changed by its changes', () => {
    const left = { name: 'before.json', text: '{"items": [{"id": 1, "q": 1}, {"id": 2, "q": 1}]}' };
    const moved = { name: 'after.json', text: '{"items": [{"id": 2, "q": 1}, {"id": 1, "q": 1}]}' };
    const { unmount: closeMoved } = render(<ViewerApp payload={diffPayload({ left, right: moved })} />);
    const show = screen.getByRole('group', { name: 'Show' });
    expect(rowPaths()).toEqual(['$.items[1]']);
    expect(diffRows()[0]).toHaveTextContent('from $.items[0]');
    const detail = screen.getByRole('region', { name: 'Selected difference' });
    expect(detail).toHaveTextContent('Moved$.items[1]was $.items[0]');
    fireEvent.click(within(show).getByRole('button', { name: /Moved 1/ }));
    expect(rowPaths()).toEqual(['$.items[1]']);
    closeMoved();
    // Moved and changed: one difference, the change, with where it was.
    const edited = { name: 'after.json', text: '{"items": [{"id": 2, "q": 1}, {"id": 1, "q": 3}]}' };
    const { unmount: closeEdited } = render(<ViewerApp payload={diffPayload({ left, right: edited })} />);
    expect(rowPaths()).toEqual(['$.items[1].q']);
    expect(diffRows()[0]).toHaveTextContent('was $.items[0].q');
    closeEdited();
    // An item that kept its index while others moved around it only changed order.
    const { unmount: closeReordered } = render(<ViewerApp payload={diffPayload({ left: { name: 'l.json', text: '["a", "b", "c"]' }, right: { name: 'r.json', text: '["c", "b", "a"]' } })} />);
    expect(diffRows().find((row) => row.textContent.includes('order changed'))).toBeDefined();
    closeReordered();
    // When the order does not matter, only the edit is left.
    render(<ViewerApp payload={diffPayload({ left, right: edited, arrays: 'unordered' })} />);
    expect(screen.getAllByText('1 difference')).toHaveLength(1);
  });

  it('filters by kind and by path', () => {
    render(<ViewerApp payload={diffPayload()} />);
    fireEvent.click(screen.getByRole('button', { name: /Added 2/ }));
    expect(diffRows()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /All 7/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter the differences by path' }), { target: { value: 'ITEMS' } });
    expect(rowPaths()).toEqual(['$.items[0]', '$.items[1].q']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter the differences by path' }), { target: { value: 'items[0].q' } });
    expect(rowPaths()).toEqual(['$.items[1].q']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter the differences by path' }), { target: { value: 'nothing' } });
    expect(screen.getByText('No differences match the filter.')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Filter the differences by path' }), { key: 'Enter' });
    expect(diffRows()).toHaveLength(0);
    expect(screen.getByText('Select a difference to see both values.')).toBeInTheDocument();
  });

  it('moves through the list with the keyboard and the search box', async () => {
    render(<ViewerApp payload={diffPayload()} />);
    const list = screen.getByRole('list');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(diffRows()[1]).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(rowPaths()[1]);
    await waitFor(() => expect(diffRows()[1]).toHaveFocus());
    fireEvent.keyDown(list, { key: 'End' });
    expect(diffRows()[6]).toHaveAttribute('aria-current', 'true');
    fireEvent.keyDown(list, { key: 'j' });
    expect(diffRows()[0]).toHaveAttribute('aria-current', 'true');
    fireEvent.keyDown(list, { key: 'k' });
    expect(diffRows()[6]).toHaveAttribute('aria-current', 'true');
    fireEvent.keyDown(list, { key: 'Home' });
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(diffRows()[6]).toHaveAttribute('aria-current', 'true');
    fireEvent.keyDown(list, { key: 'ArrowDown', ctrlKey: true });
    fireEvent.keyDown(list, { key: 'x' });
    expect(diffRows()[6]).toHaveAttribute('aria-current', 'true');
    const search = screen.getByRole('searchbox', { name: 'Filter the differences by path' });
    fireEvent.keyDown(window, { key: '/' });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(diffRows()[0]).toHaveAttribute('aria-current', 'true');
    fireEvent.keyDown(search, { key: 'Enter', shiftKey: true });
    expect(diffRows()[6]).toHaveAttribute('aria-current', 'true');
    search.blur();
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: '/' });
  });

  it('copies values', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    render(<ViewerApp payload={diffPayload()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy the new value' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('2'));
    expect(await screen.findByText('Value copied to the clipboard.')).toBeInTheDocument();
    writeText.mockRejectedValue(new Error('denied'));
    document.execCommand = jest.fn(() => false);
    fireEvent.click(screen.getByRole('button', { name: 'Copy the old value' }));
    expect(await screen.findByText('The browser blocked copying.')).toBeInTheDocument();
  });

  it('pages through very long lists', () => {
    const left = JSON.stringify(Object.fromEntries(Array.from({ length: 1200 }, (_, index) => [`k${index}`, index])));
    const right = JSON.stringify(Object.fromEntries(Array.from({ length: 1200 }, (_, index) => [`k${index}`, index + 1])));
    render(<ViewerApp payload={diffPayload({ left: { name: 'l.json', text: left }, right: { name: 'r.json', text: right } })} />);
    // Role queries are slow on a thousand buttons; find the controls by their text instead.
    expect(diffRows()).toHaveLength(500);
    fireEvent.click(screen.getByText('Show 500 more of 700'));
    expect(diffRows()).toHaveLength(1000);
    fireEvent.click(screen.getByText('Show 200 more of 200'));
    expect(diffRows()).toHaveLength(1200);
    const show = within(screen.getByRole('group', { name: 'Show' }));
    fireEvent.click(show.getByRole('button', { name: /Added 0/ }));
    fireEvent.click(show.getByRole('button', { name: /All 1,200/ }));
    expect(diffRows()).toHaveLength(500);
    // eslint-disable-next-line testing-library/no-node-access
    fireEvent.keyDown(document.querySelector('.je-diff-list'), { key: 'End' });
    expect(diffRows()).toHaveLength(1200);
    expect(diffRows()[1199]).toHaveAttribute('aria-current', 'true');
  });

  it('says when there are no differences', () => {
    render(<ViewerApp payload={diffPayload({ right: { name: 'after.json', text: diffPayload().left.text.replace('"a": 1', '"a": 1.0') } })} />);
    expect(screen.getByText('no differences')).toBeInTheDocument();
    expect(screen.getByText(/Both documents contain the same data\. Key order/)).toBeInTheDocument();
  });

  it('respects ignored paths and array matching from the command line', () => {
    render(<ViewerApp payload={diffPayload({ ignore: ['$..q', '$.b', '$.a', '$.gone', '$.id', '$.kind', '$.items[0]'] })} />);
    expect(screen.getByText(/outside the ignored paths/)).toBeInTheDocument();
  });

  it('explains documents it cannot compare', () => {
    render(<ViewerApp payload={diffPayload({ right: { name: 'after.json', text: '{' } })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The documents could not be compared');
    expect(screen.getByRole('alert')).toHaveTextContent('after.json:');
  });

  it('shows a single difference in the singular', () => {
    render(<ViewerApp payload={diffPayload({ left: { name: 'a', text: '[1]' }, right: { name: 'b', text: '[2]' } })} />);
    expect(screen.getByText('1 difference')).toBeInTheDocument();
  });
});

describe('computeChanges', () => {
  it('honours ignore paths and array matching', () => {
    const payload = diffPayload();
    expect(computeChanges(payload).changes).toHaveLength(7);
    expect(computeChanges({ ...payload, ignore: ['$'] }).changes).toEqual([]);
    expect(computeChanges({ ...payload, ignore: undefined, arrays: 'index' }).changes.map((change) => change.kind)).toContain('added');
    expect(computeChanges({ ...payload, ignore: '$.a' }).changes).toHaveLength(7);
  });

  it('reports invalid documents and ignore paths', () => {
    expect(computeChanges(diffPayload({ left: { name: 'l.json', text: '' } }))).toEqual({ error: 'l.json: the document is empty.' });
    expect(computeChanges(diffPayload({ ignore: ['$['] })).error).toMatch(/^The ignored path is not valid: Invalid JSONPath/);
  });
});

describe('invalid page', () => {
  it('explains how to create a page', () => {
    render(<ViewerApp payload={{ kind: 'invalid' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This page has no data to show');
    expect(screen.getByRole('alert')).toHaveTextContent('json-explorer explore <file>');
  });
});
