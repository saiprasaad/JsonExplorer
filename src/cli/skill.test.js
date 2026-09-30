/** @jest-environment node */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VERSION } from './version';

/*
 * The packaged skill, plugin and marketplace: built files match their sources, versions agree,
 * metadata follows the Agent Skills format, and the Python fallback writes the same pages.
 */

const ROOT = path.resolve(__dirname, '../..');
const PLUGIN = path.join(ROOT, 'plugins/json-explorer');
const SKILL = path.join(PLUGIN, 'skills/json-explorer');
const BUNDLE = path.join(SKILL, 'scripts/json-explorer.mjs');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const hasPython = spawnSync('python3', ['--version']).status === 0;

/** The SKILL.md frontmatter as flat keys (nested "metadata" keys become "metadata.<key>"). */
function frontmatter(text) {
  const [, block] = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const fields = {};
  let parent = null;
  block.split('\n').forEach((line) => {
    const match = /^(\s*)([\w-]+):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`Unexpected frontmatter line: ${line}`);
    const [, indent, key, value] = match;
    if (indent) fields[`${parent}.${key}`] = value.replace(/^"(.*)"$/, '$1');
    else {
      parent = key;
      fields[key] = value;
    }
  });
  return fields;
}

describe('build', () => {
  it('the committed skill files are what the sources build', () => {
    const result = spawnSync(process.execPath, ['scripts/build-skill.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('The skill is up to date with its sources.\n');
    expect(result.status).toBe(0);
  });

  it('the CLI is executable and starts with a shebang', () => {
    expect(fs.statSync(BUNDLE).mode & 0o111).not.toBe(0);
    expect(fs.readFileSync(BUNDLE, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
  });

  it('lists the licenses of the bundled open-source packages', () => {
    const notices = fs.readFileSync(path.join(SKILL, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
    ['react', 'react-dom', '@mui/material', 'reactflow', 'jsonc-parser', 'jsonrepair', 'ajv', 'ajv-formats', 'html-to-image'].forEach((name) => {
      expect(notices).toMatch(new RegExp(`\\n${name.replace('/', '\\/')} \\d+\\.\\d+\\.\\d+ \\(`));
    });
  });
});

describe('versions', () => {
  it('agree everywhere', () => {
    const plugin = readJson(path.join(PLUGIN, '.claude-plugin/plugin.json'));
    const marketplace = readJson(path.join(ROOT, '.claude-plugin/marketplace.json'));
    const skill = frontmatter(fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8'));
    expect(plugin.version).toBe(VERSION);
    expect(marketplace.metadata.version).toBe(VERSION);
    expect(marketplace.plugins.map((entry) => entry.version)).toEqual([VERSION]);
    expect(skill['metadata.version']).toBe(VERSION);
    expect(execFileSync(process.execPath, [BUNDLE, '--version'], { encoding: 'utf8' })).toBe(`${VERSION}\n`);
  });
});

describe('license', () => {
  it('is MIT everywhere, and the skill carries its full text', () => {
    const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const license = read(path.join(ROOT, 'LICENSE'));
    expect(license.startsWith('MIT License\n')).toBe(true);
    expect(read(path.join(SKILL, 'LICENSE.txt'))).toBe(license);
    expect(readJson(path.join(ROOT, 'package.json')).license).toBe('MIT');
    expect(readJson(path.join(PLUGIN, '.claude-plugin/plugin.json')).license).toBe('MIT');
    expect(readJson(path.join(ROOT, '.claude-plugin/marketplace.json')).plugins.map((entry) => entry.license)).toEqual(['MIT']);
    expect(frontmatter(read(path.join(SKILL, 'SKILL.md'))).license).toMatch(/^MIT\b/);
  });
});

describe('SKILL.md', () => {
  const text = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  const fields = frontmatter(text);

  it('uses only frontmatter fields that every Claude surface accepts', () => {
    const topLevel = Object.keys(fields).filter((key) => !key.includes('.'));
    topLevel.forEach((key) => expect(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']).toContain(key));
    expect(fields.name).toBe(path.basename(SKILL));
    expect(fields.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(fields.description.length).toBeGreaterThan(200);
    expect(fields.description.length).toBeLessThanOrEqual(1024);
    expect(fields.description).not.toMatch(/[<>]/);
    expect(fields.compatibility.length).toBeLessThanOrEqual(500);
  });

  it('has frontmatter that strict YAML parsers accept', () => {
    // A colon followed by a space, or " #", ends a plain YAML value early (PyYAML and claude.ai reject it).
    Object.values(fields).forEach((value) => expect(value).not.toMatch(/: | #/));
    if (!hasPython) return;
    const check = spawnSync('python3', ['-c', 'import sys, yaml; print(yaml.safe_load(sys.stdin.read().split("---")[1])["description"])'], { input: text, encoding: 'utf8' });
    if (/No module named 'yaml'/.test(check.stderr)) return;
    expect(check.stdout.trim()).toBe(fields.description);
  });

  it('stays short and points only at files that exist', () => {
    expect(text.split('\n').length).toBeLessThan(500);
    const mentioned = [...text.matchAll(/(?:\$\{CLAUDE_SKILL_DIR\}\/|`)((?:scripts|references|assets)\/[\w./-]+)/g)].map((match) => match[1]);
    expect(new Set(mentioned)).toEqual(new Set(['scripts/json-explorer.mjs', 'scripts/viewer.py', 'assets/viewer.html', 'references/jsonpath.md', 'references/commands.md']));
    mentioned.forEach((file) => expect(fs.existsSync(path.join(SKILL, file))).toBe(true));
  });

  it('describes every command the CLI has', () => {
    const help = execFileSync(process.execPath, [BUNDLE, '--help'], { encoding: 'utf8' });
    const commands = [...help.split('Commands:')[1].matchAll(/^ {2}([a-z-]+) {2,}/gm)].map((match) => match[1]);
    expect(commands).toHaveLength(10);
    commands.forEach((command) => expect(text).toContain(`\`${command}`));
  });
});

describe('plugin and marketplace', () => {
  it('wire the hook to the bundled CLI', () => {
    const { hooks } = readJson(path.join(PLUGIN, 'hooks/hooks.json'));
    expect(Object.keys(hooks)).toEqual(['PostToolUse']);
    const [group] = hooks.PostToolUse;
    expect(group.matcher.split('|')).toEqual(expect.arrayContaining(['Write', 'Edit']));
    const [hook] = group.hooks;
    // The shell form (one command string) works in every Claude Code version; "args" does not.
    expect(hook.type).toBe('command');
    expect(hook.args).toBeUndefined();
    const [, script] = /^node "(.+)" hook$/.exec(hook.command);
    // eslint-disable-next-line no-template-curly-in-string -- the literal placeholder Claude Code substitutes
    expect(fs.existsSync(script.replace('${CLAUDE_PLUGIN_ROOT}', PLUGIN))).toBe(true);
  });

  it('list the plugin from its folder', () => {
    const marketplace = readJson(path.join(ROOT, '.claude-plugin/marketplace.json'));
    const plugin = readJson(path.join(PLUGIN, '.claude-plugin/plugin.json'));
    expect(marketplace.plugins).toHaveLength(1);
    const [entry] = marketplace.plugins;
    expect(entry.name).toBe(plugin.name);
    expect(path.resolve(ROOT, entry.source)).toBe(PLUGIN);
    expect(entry.description).toBe(plugin.description);
  });
});

describe('package', () => {
  it('zips the skill folder under its name, keeping the CLI executable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'je-zip-'));
    try {
      const zip = path.join(dir, 'json-explorer.skill');
      const encoded = execFileSync(process.execPath, ['--input-type=module', '-e', `import('${path.join(ROOT, 'scripts/build-skill.mjs')}').then((m) => process.stdout.write(m.zipDirectory(${JSON.stringify(SKILL)}, 'json-explorer').toString('base64')))`], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      fs.writeFileSync(zip, Buffer.from(encoded, 'base64'));
      if (!hasPython) return;
      const listing = execFileSync(
        'python3',
        ['-c', 'import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nfor i in z.infolist(): print(i.filename, oct(i.external_attr >> 16))', zip],
        { encoding: 'utf8' }
      );
      const entries = Object.fromEntries(listing.trim().split('\n').map((line) => line.split(' ')));
      expect(Object.keys(entries).every((name) => name.startsWith('json-explorer/'))).toBe(true);
      expect(entries).toMatchObject({ 'json-explorer/SKILL.md': '0o100644', 'json-explorer/scripts/json-explorer.mjs': '0o100755', 'json-explorer/assets/viewer.html': '0o100644' });
      expect(Object.keys(entries).some((name) => name.includes('__pycache__'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

(hasPython ? describe : describe.skip)('Python fallback', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'je-py-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const files = {
    'data.json': '{"name": "Ada", "id": 12345678901234567890, "html": "</script><!--", "text": "\u2028\u00e9", "marker": "__JSON_EXPLORER_TITLE__ /*JSON_EXPLORER_DATA*/"}\n',
    'after.json': '{"name": "Bo", "id": 1}',
    'tsconfig.json': '// c\n{\n  "a": [1, 2,], /* x */ "b": "// not a comment",\n}\n',
    'events.jsonl': '{"a":1}\r\n\r\nnope\n  [2]  \n',
  };
  // Default pages go to a folder inside the test directory, never to the real user cache.
  const env = () => ({ ...process.env, JSON_EXPLORER_PAGES: path.join(dir, 'pages') });
  const node = (...args) => spawnSync(process.execPath, [BUNDLE, ...args], { cwd: dir, encoding: 'utf8', env: env() });
  const python = (...args) => spawnSync('python3', [path.join(SKILL, 'scripts/viewer.py'), ...args], { cwd: dir, encoding: 'utf8', env: env() });

  it('writes the same pages as the CLI', () => {
    Object.entries(files).forEach(([name, content]) => fs.writeFileSync(path.join(dir, name), content));
    [
      ['explore', 'data.json', '-o', 'X.html', '--title', 'T & <t>'],
      ['explore', 'tsconfig.json', '-o', 'X.html', '--view', 'tree'],
      ['explore', 'events.jsonl', '-o', 'X.html'],
    ].forEach((args) => {
      const fromNode = node(...args.map((arg) => arg.replace('X', 'node')));
      const fromPython = python(...args.map((arg) => arg.replace('X', 'python')));
      expect([args.join(' '), fromNode.status, fromPython.status]).toEqual([args.join(' '), 0, 0]);
      expect(fs.readFileSync(path.join(dir, 'python.html'), 'utf8')).toBe(fs.readFileSync(path.join(dir, 'node.html'), 'utf8'));
      expect(fs.statSync(path.join(dir, 'python.html')).mode & 0o777).toBe(0o600);
    });
    node('diff', 'data.json', 'after.json', '--html', 'node.html', '--ignore', '$.id');
    expect(python('diff', 'data.json', 'after.json', '-o', 'python.html', '--ignore', '$.id').status).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'python.html'), 'utf8')).toBe(fs.readFileSync(path.join(dir, 'node.html'), 'utf8'));
  });

  it('writes to the private pages folder by default, under the name the CLI uses, and explains problems', () => {
    fs.writeFileSync(path.join(dir, 'data.json'), files['data.json']);
    const pages = path.join(dir, 'pages');
    const written = python('explore', 'data.json');
    const [page] = fs.readdirSync(pages);
    expect(page).toMatch(/^data\.[0-9a-f]{8}\.explorer\.html$/);
    expect(written.stdout).toBe(
      `Wrote ${path.join('pages', page)} (${(fs.statSync(path.join(pages, page)).size / 1024).toFixed(1)} KB, readable only by you).\nOpen it in any web browser: file://${path.join(pages, page)}\nIt works offline: the data is inside the page, and the page makes no network requests.\n`
    );
    expect(fs.statSync(pages).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(pages, page)).mode & 0o777).toBe(0o600);
    node('explore', 'data.json');
    expect(fs.readdirSync(pages)).toEqual([page]);
    expect(python('explore', 'data.json', '-o', 'data.json').stderr).toBe('Error: Refusing to write over the input data.json; choose another output file.\n');
    expect(python('explore', 'data.json', '-o', 'nowhere/x.html')).toMatchObject({ status: 2, stderr: expect.stringMatching(/^Error: Cannot write nowhere\/x\.html: /) });
    fs.mkdirSync(path.join(dir, '.git'));
    expect(python('explore', 'data.json', '-o', 'page.html').stderr).toBe('Note: page.html is inside a git repository and holds all of the data: keep it out of commits (for example, list it in .gitignore).\n');
    fs.writeFileSync(path.join(dir, 'joined.jsonc'), '{"ids": [1 2, 3]}');
    expect(python('explore', 'joined.jsonc').stderr).toContain("is not valid JSON with comments: expected ',' between values.");
    expect(python('diff', 'data.json', 'data.json', '--array-match', 'unordered', '-o', 'd.html').status).toBe(0);
    fs.writeFileSync(path.join(dir, 'bad.json'), '{"a": 1,}');
    const bad = python('explore', 'bad.json');
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/^Error: bad\.json is not valid JSON: /);
    expect(python('explore', 'missing.json').stderr).toBe('Error: missing.json: no such file.\n');
    expect(python('explore', 'data.json', '--view', 'table').stderr).toBe('Error: --view expects "graph" or "tree".\n');
  });
});
