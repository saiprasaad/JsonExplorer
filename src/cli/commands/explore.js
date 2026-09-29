import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatBytes } from '../../utils/json';
import { UsageError } from '../args';
import { buildViewerPage } from '../html';
import { InputError, writeFileAtomic } from '../io';
import { VERSION } from '../version';
import { displayPath, expectPositionals, INPUT_OPTIONS, loadDocument } from './shared';

const USAGE = 'explore <file> [-o <viewer.html>] [--view graph|tree] [--title <text>]';
// Browsers slow down with very large pages; past the hard limit, ask for --force.
const SOFT_LIMIT = 50 * 1024 * 1024;
const HARD_LIMIT = 200 * 1024 * 1024;

export function readTemplate(ctx) {
  const file = path.join(ctx.assetsDir, 'viewer.html');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    throw new InputError(`The viewer template is missing (${file}). Reinstall the JSON Explorer skill.`);
  }
}

const PAGE_NAME = /\.(explorer|diff)\.html$/;
const KEEP_PAGES_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The folder where pages go by default: private to the user, in their cache folder, outside any
 * project (so a page holding all of the data is never committed or synced with it).
 * JSON_EXPLORER_PAGES overrides it.
 */
export function pagesFolder(ctx) {
  const { env } = ctx;
  if (env.JSON_EXPLORER_PAGES) return path.resolve(ctx.cwd, env.JSON_EXPLORER_PAGES);
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const platform = ctx.platform ?? process.platform;
  let cache;
  if (platform === 'darwin') cache = path.join(home, 'Library', 'Caches');
  else if (platform === 'win32') cache = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  else cache = env.XDG_CACHE_HOME && path.isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : path.join(home, '.cache');
  return path.join(cache, 'json-explorer', 'pages');
}

/** Where a generated page goes by default: <name>.<tag>.<suffix>.html in the pages folder, one per input. */
export function defaultOutput(file, suffix, ctx) {
  const folder = pagesFolder(ctx);
  if (file === '-') return path.join(folder, `stdin.${suffix}.html`);
  const absolute = path.resolve(ctx.cwd, file);
  const base = path.basename(absolute).replace(/\.(jsonl|ndjson|jsonlines|jsonc|json|geojson)$/i, '');
  const tag = crypto.createHash('sha256').update(absolute).digest('hex').slice(0, 8);
  return path.join(folder, `${base}.${tag}.${suffix}.html`);
}

/** Creates the pages folder for the owner only, and checks that it is a real folder of theirs. */
function preparePagesFolder(folder) {
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(folder);
  const uid = process.getuid?.();
  if (!stat.isDirectory() || (uid !== undefined && stat.uid !== uid)) {
    throw new InputError(`${folder} is not a private folder of yours; set JSON_EXPLORER_PAGES to another folder, or write the page with -o.`);
  }
  if ((stat.mode & 0o077) !== 0) fs.chmodSync(folder, 0o700);
}

/** Deletes pages older than a week from the pages folder (best effort: pages hold data). */
function pruneOldPages(folder, now = Date.now()) {
  try {
    fs.readdirSync(folder).forEach((name) => {
      const file = path.join(folder, name);
      const stat = fs.lstatSync(file);
      if (PAGE_NAME.test(name) && stat.isFile() && now - stat.mtimeMs > KEEP_PAGES_MS) fs.rmSync(file);
    });
  } catch {
    // Old pages stay until the next run.
  }
}

/** Whether a path lies inside a git work tree (a .git folder or file in it or above it). */
function insideGitRepository(file) {
  for (let folder = path.dirname(file); ; folder = path.dirname(folder)) {
    if (fs.existsSync(path.join(folder, '.git'))) return true;
    if (path.dirname(folder) === folder) return false;
  }
}

/** Writes a page (readable by the owner only, even over an older page) and says how to open it. */
export function writePage(target, html, ctx, { inputs }) {
  const folder = pagesFolder(ctx);
  const private_ = path.dirname(target) === folder;
  if (private_) {
    preparePagesFolder(folder);
    pruneOldPages(folder);
  }
  const written = writeFileAtomic(target, html, { mode: 0o600, forceMode: true, inputs });
  ctx.out(`Wrote ${displayPath(written, ctx.cwd)} (${formatBytes(Buffer.byteLength(html))}, readable only by you).`);
  ctx.out(`Open it in any web browser: ${pathToFileURL(written).href}`);
  ctx.out('It works offline: the data is inside the page, and the page makes no network requests.');
  if (!private_ && insideGitRepository(written)) {
    ctx.err(`Note: ${displayPath(written, ctx.cwd)} is inside a git repository and holds all of the data: keep it out of commits (for example, list it in .gitignore).`);
  }
}

export const explore = {
  name: 'explore',
  summary: 'Write an interactive graph/tree viewer as one offline HTML file (no network)',
  usage: USAGE,
  description: [
    'Creates a self-contained page with an interactive graph and tree of the document: search,',
    'expand/collapse, details with exact values and paths, a table view for lists of records,',
    'conversions and image export. The data stays inside the file; a strict Content Security',
    'Policy blocks every network request. The page is readable only by you and, by default, goes to',
    'a private folder in your user cache (outside the project, so it is never committed with it;',
    'set JSON_EXPLORER_PAGES to use another folder). Pages there are deleted after a week.',
  ],
  options: {
    out: { type: 'string', alias: 'o', description: 'Where to write the page instead of the private pages folder.' },
    view: { type: 'string', description: 'Start in the graph (default) or tree view.' },
    title: { type: 'string', description: 'Page title (default: the file name).' },
    force: { type: 'boolean', description: 'Allow documents over 200 MB (browsers may struggle).' },
    ...INPUT_OPTIONS,
  },
  examples: ['explore data.json', 'explore events.jsonl --view tree', 'explore response.json -o response.html'],

  async run({ values, positionals }, ctx) {
    expectPositionals(positionals, 1, 1, USAGE);
    const [file] = positionals;
    const view = values.view ?? 'graph';
    if (view !== 'graph' && view !== 'tree') throw new UsageError('--view expects "graph" or "tree".');
    const template = readTemplate(ctx);
    const document = await loadDocument(file, values, ctx, { skipInvalidLines: true });
    const size = Buffer.byteLength(document.json);
    if (size > HARD_LIMIT && !values.force) {
      throw new InputError(`${document.input.name} is ${formatBytes(size)}; pages this large may not open in a browser. Use --force to write it anyway, or explore a part of it (query … -o part.json).`);
    }
    const name = file === '-' ? 'stdin' : path.basename(file);
    const payload = { kind: 'document', name, text: document.json, dialect: document.dialect, view, bytes: document.input.bytes, generator: `JSON Explorer ${VERSION}` };
    const html = buildViewerPage(template, payload, values.title ?? `${name} · JSON Explorer`);
    writePage(values.out ? path.resolve(ctx.cwd, values.out) : defaultOutput(file, 'explorer', ctx), html, ctx, { inputs: [document.input.path] });
    if (size > SOFT_LIMIT) ctx.err(`Note: the document is ${formatBytes(size)}, so the page may take a while to open.`);
    return 0;
  },
};
