import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { DEFAULT_JSON } from './samples';
import { encodeShareText } from './utils/share';

const editor = () => screen.getByTestId('monaco-editor');
const typeJson = (text) => fireEvent.change(editor(), { target: { value: text } });
// Graph nodes are drawn by React Flow without an accessible role, so query their labels by class.
// eslint-disable-next-line testing-library/no-node-access
const nodeLabels = () => Array.from(document.querySelectorAll('.je-node-label')).map((element) => element.textContent);

describe('JSON Explorer', () => {
  test('renders the editor, the status bar and the graph for the default document', async () => {
    render(<App />);

    expect(screen.getByRole('tab', { name: /Graph/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Tree/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Compare/ })).toBeInTheDocument();
    expect(editor()).toHaveValue(DEFAULT_JSON);
    expect(screen.getByText('Valid JSON')).toBeInTheDocument();
    await waitFor(() => expect(nodeLabels()).toEqual(expect.arrayContaining(['root', 'catalog', 'products', 'promotions'])));
  });

  test('explains invalid JSON precisely and keeps showing the last valid graph', async () => {
    render(<App />);
    typeJson('{\n  "catalog": {\n    "name": "x",\n  }\n}');

    expect(await screen.findByText("Trailing comma before '}' is not allowed")).toBeInTheDocument();
    expect(screen.getByText('Ln 3, Col 16')).toBeInTheDocument();
    expect(screen.getByText(/showing the last valid version/)).toBeInTheDocument();
    expect(nodeLabels()).toContain('products');
  });

  test('formats and minifies without changing number literals', () => {
    render(<App />);
    typeJson('{"id": 12345678901234567890, "price": 1.50, "list": [1, 2]}');

    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    expect(editor()).toHaveValue('{\n  "id": 12345678901234567890,\n  "price": 1.50,\n  "list": [\n    1,\n    2\n  ]\n}');

    fireEvent.click(screen.getByRole('button', { name: 'Minify' }));
    expect(editor()).toHaveValue('{"id":12345678901234567890,"price":1.50,"list":[1,2]}');
  });

  test('repairs common mistakes such as single quotes, trailing commas and Python literals', async () => {
    render(<App />);
    typeJson("{name: 'Ada', tags: ['a', 'b',], active: True, // note\n}");
    await screen.findByText('Property names must be wrapped in double quotes');

    fireEvent.click(screen.getByRole('button', { name: 'Repair' }));
    await waitFor(() => expect(JSON.parse(editor().value)).toEqual({ name: 'Ada', tags: ['a', 'b'], active: true }));
    expect(await screen.findByText('Valid JSON')).toBeInTheDocument();
  });

  test('clicking a node opens the details panel with its path and value', async () => {
    render(<App />);
    const label = await screen.findByText('promotions', { selector: '.je-node-label' });
    fireEvent.click(label);

    const details = await screen.findByRole('complementary', { name: 'Details' });
    expect(within(details).getByText('$.catalog.promotions')).toBeInTheDocument();
    expect(within(details).getByText('2 keys')).toBeInTheDocument();
    expect(within(details).getByText(/"discountPercent"/)).toBeInTheDocument();
  });

  test('switches to the tree view', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /Tree/ }));

    const tree = await screen.findByRole('tree');
    expect(within(tree).getByText('storeName')).toBeInTheDocument();
    expect(within(tree).getByText('"TechStuff Online"')).toBeInTheDocument();
  });

  test('compare view lists structural differences between the two documents', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /Compare/ }));

    const panel = await screen.findByRole('region', { name: 'Structural differences' });
    const row = await within(panel).findByRole('button', { name: /^Changed \$\.catalog\.currency\b/ });
    expect(within(row).getByText('"USD"')).toBeInTheDocument();
    expect(within(row).getByText('"EUR"')).toBeInTheDocument();
    expect(within(panel).getByText('+4')).toBeInTheDocument();
  });

  test('loads a document from a shared link and clears the hash', async () => {
    window.history.replaceState(null, '', `/#json=${encodeShareText('{"shared": [1, 2, 3]}')}`);
    render(<App />);

    expect(editor()).toHaveValue('{"shared": [1, 2, 3]}');
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(await screen.findByText('Loaded the shared JSON.')).toBeInTheDocument();
  });

  test('restores the autosaved document', () => {
    window.localStorage.setItem('json-explorer:document', '{"saved": true}');
    render(<App />);
    expect(editor()).toHaveValue('{"saved": true}');
  });

  test('embed mode hides the editor and renders JSON posted by the parent page', async () => {
    window.history.replaceState(null, '', '/?embed=1');
    render(<App />);

    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByText('Waiting for JSON from the parent page…')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'json-explorer:set-json', payload: { embedded: { answer: 42 } } } })
      );
    });

    await waitFor(() => expect(nodeLabels()).toContain('embedded'));
    expect(screen.queryByText('Waiting for JSON from the parent page…')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('json-explorer:document')).toBeNull();
  });
});
