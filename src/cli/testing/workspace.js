import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_MARKER, TITLE_MARKER } from '../html';
import { main } from '../main';

/*
 * Test harness for the CLI: a temporary working directory with input files and a minimal viewer
 * template, and `run(argv)` that calls main() with captured output instead of a real process.
 */

export const TEMPLATE = `<!doctype html><title>${TITLE_MARKER}</title><script type="application/json" id="je-data">${DATA_MARKER}</script>`;

/** The payload embedded in a page written from TEMPLATE. */
export function pagePayload(html) {
  const start = html.indexOf('id="je-data">') + 'id="je-data">'.length;
  return JSON.parse(html.slice(start, html.indexOf('</script>', start)));
}

export function makeWorkspace(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'je-cli-'));
  const cwd = path.join(root, 'work');
  const assetsDir = path.join(root, 'assets');
  fs.mkdirSync(cwd);
  fs.mkdirSync(assetsDir);
  fs.writeFileSync(path.join(assetsDir, 'viewer.html'), TEMPLATE);
  const file = (name) => path.join(cwd, name);
  const write = (name, content) => {
    fs.mkdirSync(path.dirname(file(name)), { recursive: true });
    fs.writeFileSync(file(name), content);
    return file(name);
  };
  Object.entries(files).forEach(([name, content]) => write(name, content));

  // Pages go to a private folder inside the workspace unless a test says otherwise.
  const pages = path.join(root, 'pages');
  const run = async (argv, { stdin = '', env = {}, platform, stdoutIsTTY = false } = {}) => {
    let stdout = '';
    let stderr = '';
    const code = await main(argv, {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
      stdin,
      cwd,
      env: { JSON_EXPLORER_PAGES: pages, ...env },
      platform,
      stdoutIsTTY,
      assetsDir,
      scriptPath: '/skills/json-explorer/scripts/json-explorer.mjs',
    });
    return { code, stdout, stderr };
  };

  return {
    root,
    cwd,
    pages,
    assetsDir,
    file,
    write,
    run,
    read: (name) => fs.readFileSync(file(name), 'utf8'),
    /** The path of the page in the pages folder whose name starts with `prefix`, or null. */
    pageFile: (prefix = '') => {
      const name = fs.existsSync(pages) ? fs.readdirSync(pages).find((entry) => entry.startsWith(prefix)) : undefined;
      return name === undefined ? null : path.join(pages, name);
    },
    exists: (name) => fs.existsSync(file(name)),
    mode: (name) => fs.statSync(file(name)).mode & 0o777,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
