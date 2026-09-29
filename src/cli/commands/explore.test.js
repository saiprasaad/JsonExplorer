/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatBytes } from '../../utils/json';
import { makeWorkspace, pagePayload } from '../testing/workspace';
import { VERSION } from '../version';
import { pathToFileURL } from 'node:url';
import { defaultOutput, pagesFolder } from './explore';

const DATA = '{"name": "Ada", "id": 12345678901234567890, "note": "</script><script>alert(1)</script>"}';

let ws;
beforeEach(() => {
  ws = makeWorkspace({ 'data.json': DATA });
});
afterEach(() => {
  ws.cleanup();
  jest.restoreAllMocks();
});

describe('explore', () => {
  const modeOf = (file) => fs.statSync(file).mode & 0o777;

  it('writes an owner-only page to the private pages folder, with the data embedded', async () => {
    const { code, stdout, stderr } = await ws.run(['explore', 'data.json']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const file = ws.pageFile();
    expect(path.basename(file)).toMatch(/^data\.[0-9a-f]{8}\.explorer\.html$/);
    const html = fs.readFileSync(file, 'utf8');
    expect(stdout).toBe(
      `Wrote ${file} (${formatBytes(Buffer.byteLength(html))}, readable only by you).\nOpen it in any web browser: ${pathToFileURL(file).href}\nIt works offline: the data is inside the page, and the page makes no network requests.\n`
    );
    expect(modeOf(file)).toBe(0o600);
    expect(modeOf(ws.pages)).toBe(0o700);
    expect(html).toContain('<title>data.json · JSON Explorer</title>');
    expect(html).not.toContain('</script><script>alert(1)');
    expect(pagePayload(html)).toEqual({ kind: 'document', name: 'data.json', text: DATA, dialect: 'json', view: 'graph', bytes: Buffer.byteLength(DATA), generator: `JSON Explorer ${VERSION}` });
  });

  it('keeps one page per input, owner-only even over an older page, and deletes pages older than a week', async () => {
    await ws.run(['explore', 'data.json']);
    const file = ws.pageFile();
    fs.chmodSync(file, 0o644);
    await ws.run(['explore', 'data.json']);
    expect(fs.readdirSync(ws.pages)).toEqual([path.basename(file)]);
    expect(modeOf(file)).toBe(0o600);
    ws.write('other/data.json', '[1]');
    await ws.run(['explore', 'other/data.json']);
    expect(fs.readdirSync(ws.pages)).toHaveLength(2);
    const weekAgo = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
    const old = path.join(ws.pages, 'old.12345678.diff.html');
    const other = path.join(ws.pages, 'notes.txt');
    [old, other].forEach((name) => {
      fs.writeFileSync(name, 'x');
      fs.utimesSync(name, weekAgo, weekAgo);
    });
    await ws.run(['explore', 'data.json']);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(other)).toBe(true);
  });

  it('makes the pages folder private, and refuses one that is not a real folder', async () => {
    fs.mkdirSync(ws.pages);
    fs.chmodSync(ws.pages, 0o755);
    await ws.run(['explore', 'data.json']);
    expect(modeOf(ws.pages)).toBe(0o700);
    fs.rmSync(ws.pages, { recursive: true });
    fs.mkdirSync(path.join(ws.root, 'elsewhere'));
    fs.symlinkSync(path.join(ws.root, 'elsewhere'), ws.pages);
    const refused = await ws.run(['explore', 'data.json']);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toBe(`json-explorer: ${ws.pages} is not a private folder of yours; set JSON_EXPLORER_PAGES to another folder, or write the page with -o.\n`);
  });

  it('notes when a page it was asked to write lands in a git repository', async () => {
    const outside = await ws.run(['explore', 'data.json', '-o', 'page.html']);
    expect(outside.stderr).toBe('');
    ws.write('.git/HEAD', 'ref: refs/heads/main\n');
    const inside = await ws.run(['explore', 'data.json', '-o', 'page.html']);
    expect(inside.stderr).toBe('Note: page.html is inside a git repository and holds all of the data: keep it out of commits (for example, list it in .gitignore).\n');
  });

  it('never writes over its input', async () => {
    const { code, stderr } = await ws.run(['explore', 'data.json', '-o', 'data.json']);
    expect(code).toBe(2);
    expect(stderr).toBe(`json-explorer: Refusing to write over the input ${ws.file('data.json')}; choose another output file.\n`);
    expect(ws.read('data.json')).toBe(DATA);
  });

  it('takes an output path, a start view and a title', async () => {
    ws.write('out/.keep', '');
    const { stdout } = await ws.run(['explore', 'data.json', '-o', 'out/page.html', '--view', 'tree', '--title', 'Q3 <report> & "notes"']);
    expect(stdout).toMatch(/^Wrote out\/page\.html \(/);
    const html = ws.read('out/page.html');
    expect(html).toContain('<title>Q3 &lt;report&gt; &amp; &quot;notes&quot;</title>');
    expect(pagePayload(html).view).toBe('tree');
  });

  it('prints absolute paths outside the working directory', async () => {
    const outside = path.join(ws.root, 'elsewhere.html');
    expect((await ws.run(['explore', 'data.json', '-o', outside])).stdout).toMatch(new RegExp(`^Wrote ${outside.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(`));
  });

  it('explains an output folder that does not exist', async () => {
    const { code, stderr } = await ws.run(['explore', 'data.json', '-o', 'nowhere/page.html']);
    expect(code).toBe(2);
    expect(stderr).toBe(`json-explorer: Cannot write ${ws.file('nowhere/page.html')}: the folder ${ws.file('nowhere')} does not exist.\n`);
  });

  it('rejects an unknown view', async () => {
    const { code, stderr } = await ws.run(['explore', 'data.json', '--view', 'table']);
    expect(code).toBe(2);
    expect(stderr).toContain('--view expects "graph" or "tree".');
  });

  it('turns JSON Lines into a list of records and JSONC into JSON', async () => {
    ws.write('logs.jsonl', '{"a":1}\nbroken\n{"a":2}\n');
    const jsonl = await ws.run(['explore', 'logs.jsonl']);
    expect(jsonl.stderr).toMatch(/^Note: 1 invalid line skipped \(first at line 2, column 1: /);
    expect(pagePayload(fs.readFileSync(ws.pageFile('logs.'), 'utf8'))).toMatchObject({ name: 'logs.jsonl', text: '[{"a":1},\n{"a":2}]', dialect: 'jsonl' });
    ws.write('tsconfig.json', '{\n  // compiler\n  "strict": true,\n}\n');
    await ws.run(['explore', 'tsconfig.json']);
    expect(pagePayload(fs.readFileSync(ws.pageFile('tsconfig.'), 'utf8'))).toMatchObject({ text: '{"strict":true}', dialect: 'jsonc' });
  });

  it('reads stdin', async () => {
    await ws.run(['explore', '-'], { stdin: '[1, 2]' });
    expect(pagePayload(fs.readFileSync(path.join(ws.pages, 'stdin.explorer.html'), 'utf8'))).toMatchObject({ name: 'stdin', text: '[1, 2]' });
  });

  it('refuses invalid documents', async () => {
    ws.write('bad.json', '{"a": }');
    const { code, stderr } = await ws.run(['explore', 'bad.json']);
    expect(code).toBe(2);
    expect(stderr).toMatch(/^json-explorer: bad\.json is not valid JSON/);
    expect(ws.pageFile()).toBeNull();
  });

  it('explains a missing viewer template', async () => {
    fs.rmSync(path.join(ws.assetsDir, 'viewer.html'));
    const { code, stderr } = await ws.run(['explore', 'data.json']);
    expect(code).toBe(2);
    expect(stderr).toBe(`json-explorer: The viewer template is missing (${path.join(ws.assetsDir, 'viewer.html')}). Reinstall the JSON Explorer skill.\n`);
  });

  it('asks for --force above 200 MB and warns above 50 MB', async () => {
    const byteLength = Buffer.byteLength;
    jest.spyOn(Buffer, 'byteLength').mockImplementationOnce(() => 300 * 1024 * 1024);
    const refused = await ws.run(['explore', 'data.json']);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toBe('json-explorer: data.json is 300.0 MB; pages this large may not open in a browser. Use --force to write it anyway, or explore a part of it (query … -o part.json).\n');
    Buffer.byteLength.mockImplementationOnce(() => 300 * 1024 * 1024);
    const forced = await ws.run(['explore', 'data.json', '--force']);
    expect(forced.code).toBe(0);
    expect(forced.stderr).toBe('Note: the document is 300.0 MB, so the page may take a while to open.\n');
    Buffer.byteLength.mockImplementationOnce(() => 60 * 1024 * 1024);
    expect((await ws.run(['explore', 'data.json'])).stderr).toBe('Note: the document is 60.0 MB, so the page may take a while to open.\n');
    expect(Buffer.byteLength('abc')).toBe(byteLength('abc'));
  });

  it('needs exactly one file', async () => {
    expect((await ws.run(['explore'])).stderr).toContain('Usage: json-explorer explore <file>');
  });
});

describe('defaultOutput', () => {
  it('names a page after its input, tagged by the folder the input is in', () => {
    const ctx = { cwd: '/work', env: { JSON_EXPLORER_PAGES: '/pages' } };
    const tag = (name) => defaultOutput(name, 'explorer', ctx).split('.').slice(-3, -2)[0];
    expect(defaultOutput('a/b.JSON', 'explorer', ctx)).toMatch(/^\/pages\/b\.[0-9a-f]{8}\.explorer\.html$/);
    expect(defaultOutput('/x/map.geojson', 'explorer', ctx)).toMatch(/^\/pages\/map\.[0-9a-f]{8}\.explorer\.html$/);
    expect(defaultOutput('/x/e.ndjson', 'diff', ctx)).toMatch(/^\/pages\/e\.[0-9a-f]{8}\.diff\.html$/);
    expect(defaultOutput('/x/notes.txt', 'explorer', ctx)).toMatch(/^\/pages\/notes\.txt\.[0-9a-f]{8}\.explorer\.html$/);
    expect(defaultOutput('-', 'diff', ctx)).toBe('/pages/stdin.diff.html');
    expect(tag('/x/data.json')).toBe(tag('/x/./data.json'));
    expect(tag('/x/data.json')).not.toBe(tag('/y/data.json'));
  });
});

describe('pagesFolder', () => {
  it('uses the user cache folder of each system, or JSON_EXPLORER_PAGES', () => {
    const env = { HOME: '/home/u' };
    expect(pagesFolder({ env, cwd: '/', platform: 'linux' })).toBe('/home/u/.cache/json-explorer/pages');
    expect(pagesFolder({ env: { ...env, XDG_CACHE_HOME: '/xdg' }, cwd: '/', platform: 'linux' })).toBe('/xdg/json-explorer/pages');
    expect(pagesFolder({ env: { ...env, XDG_CACHE_HOME: 'relative' }, cwd: '/', platform: 'linux' })).toBe('/home/u/.cache/json-explorer/pages');
    expect(pagesFolder({ env, cwd: '/', platform: 'darwin' })).toBe('/home/u/Library/Caches/json-explorer/pages');
    expect(pagesFolder({ env: { ...env, LOCALAPPDATA: '/local' }, cwd: '/', platform: 'win32' })).toBe('/local/json-explorer/pages');
    expect(pagesFolder({ env, cwd: '/', platform: 'win32' })).toBe('/home/u/AppData/Local/json-explorer/pages');
    expect(pagesFolder({ env: { USERPROFILE: '/users/u' }, cwd: '/', platform: 'linux' })).toBe('/users/u/.cache/json-explorer/pages');
    expect(pagesFolder({ env: {}, cwd: '/' })).toBe(path.join(os.homedir(), '.cache', 'json-explorer', 'pages'));
    expect(pagesFolder({ env: { JSON_EXPLORER_PAGES: 'mine' }, cwd: '/work' })).toBe('/work/mine');
  });
});
