/** @jest-environment node */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { looksLikeSecret } from './redact';
import { FAKE } from './testing/fakeSecrets';

/*
 * The privacy guarantees of the JSON Explorer skill, checked end to end:
 * - the CLI source and its bundle use no networking modules or APIs;
 * - running every command, with networking booby-trapped, never attempts a connection;
 * - the viewer page can only run its own script and cannot load or send anything;
 * - the Python fallback imports nothing that can reach the network;
 * - no file in the repository holds a secret-shaped string (the masking tests build theirs).
 */

const ROOT = path.resolve(__dirname, '../..');
const SKILL = path.join(ROOT, 'plugins/json-explorer/skills/json-explorer');
const BUNDLE = path.join(SKILL, 'scripts/json-explorer.mjs');
const VIEWER = path.join(SKILL, 'assets/viewer.html');
const NETWORK_MODULES = ['http', 'https', 'http2', 'net', 'tls', 'dns', 'dgram', 'child_process', 'worker_threads', 'cluster', 'inspector'];
const NETWORK_APIS = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b/;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__fixtures__' || entry.name === 'testing' ? [] : sourceFiles(file);
    return /\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name) ? [file] : [];
  });
}

const importedModules = (text) => [...text.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)['"](?:node:)?([^'"]+)['"]/g)].map((match) => match[1]);

describe('the CLI has no way to reach the network', () => {
  it('imports no networking modules and uses no networking APIs in its source', () => {
    const files = sourceFiles(path.join(ROOT, 'src/cli'));
    expect(files.length).toBeGreaterThan(10);
    files.forEach((file) => {
      const text = fs.readFileSync(file, 'utf8');
      importedModules(text).forEach((name) => expect([file, name]).not.toEqual([file, expect.stringMatching(new RegExp(`^(${NETWORK_MODULES.join('|')})(/|$)`))]));
      expect([file, NETWORK_APIS.exec(text)?.[0] ?? null]).toEqual([file, null]);
    });
  });

  it('bundles only file-system and text-processing built-ins', () => {
    const text = fs.readFileSync(BUNDLE, 'utf8');
    const imports = new Set([...text.matchAll(/^import .* from ["']node:([^"']+)["'];$/gm)].map((match) => match[1]));
    expect([...imports].sort()).toEqual(['crypto', 'fs', 'module', 'os', 'path', 'stream', 'url']);
    const network = new RegExp(`(?:require\\(|import\\(|from\\s+)\\s*["'](?:node:)?(?:${NETWORK_MODULES.join('|')})["']`);
    expect(network.exec(text)).toBeNull();
    expect(NETWORK_APIS.exec(text)).toBeNull();
  });

  it('never attempts a connection while running every command', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'je-net-'));
    try {
      // Booby-trap every way Node can open a connection or resolve a name.
      const guard = path.join(dir, 'guard.cjs');
      fs.writeFileSync(
        guard,
        `const trap = (what) => () => { process.stderr.write('NETWORK ATTEMPT: ' + what + '\\n'); process.exit(99); };
         for (const name of ['net', 'tls', 'http', 'https', 'http2', 'dns', 'dgram']) {
           const mod = require(name);
           for (const key of Object.keys(mod)) if (typeof mod[key] === 'function' && /^(connect|createConnection|request|get|lookup|resolve.*|createSocket)$/.test(key)) mod[key] = trap(name + '.' + key);
         }
         require('net').Socket.prototype.connect = trap('net.Socket.connect');
         globalThis.fetch = trap('fetch');`
      );
      fs.writeFileSync(path.join(dir, 'a.json'), '{"users": [{"id": 1, "url": "https://example.com/x", "password": "p"}], "n": 1.50}');
      fs.writeFileSync(path.join(dir, 'b.json'), '{"users": [{"id": 2, "url": "http://127.0.0.1:9/"}], "n": 2}');
      fs.writeFileSync(path.join(dir, 'bad.json'), "{'a': 1,}");
      fs.writeFileSync(path.join(dir, 'e.jsonl'), '{"a": 1}\n{"a": 2}\n');
      fs.writeFileSync(path.join(dir, 's.json'), '{"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://example.com/s", "type": "object"}');
      const runs = [
        ['explore', 'a.json'],
        ['outline', 'a.json', '--samples', '2'],
        ['outline', 'e.jsonl'],
        ['query', 'a.json', '$..url'],
        ['query', 'e.jsonl', '$[*].a'],
        ['diff', 'a.json', 'b.json', '--html', '-'],
        ['validate', 'a.json', 'e.jsonl', '--schema', 's.json'],
        ['repair', 'bad.json', '--diff'],
        ['format', 'a.json'],
        ['minify', 'a.json'],
        ['sort-keys', 'a.json'],
        ['convert', 'a.json', '--to', 'yaml'],
        ['convert', 'a.json', '--to', 'ts'],
      ];
      runs.forEach((args) => {
        // Pages go to the test folder, never to the real user cache.
        const env = { ...process.env, JSON_EXPLORER_PAGES: path.join(dir, 'pages') };
        const result = spawnSync(process.execPath, ['--require', guard, BUNDLE, ...args], { cwd: dir, encoding: 'utf8', env });
        expect([args.join(' '), result.stderr.includes('NETWORK ATTEMPT') ? result.stderr : 'no network']).toEqual([args.join(' '), 'no network']);
        expect([args.join(' '), result.status]).toEqual([args.join(' '), args[0] === 'diff' ? 1 : 0]);
      });
      // The guard itself works.
      const probe = spawnSync(process.execPath, ['--require', guard, '-e', "require('https').get('https://example.com')"], { encoding: 'utf8' });
      expect(probe.status).toBe(99);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the viewer page cannot load or send anything', () => {
  const html = fs.readFileSync(VIEWER, 'utf8');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];
  const directives = Object.fromEntries(
    (csp ?? '').split(';').map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources.join(' ')];
    })
  );

  it('has a strict Content Security Policy before anything else loads', () => {
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<style>'));
    expect(directives).toMatchObject({
      'default-src': "'none'",
      'style-src': "'unsafe-inline'",
      'img-src': 'data: blob:',
      'font-src': 'data:',
      'connect-src': "'none'",
      'media-src': "'none'",
      'object-src': "'none'",
      'frame-src': "'none'",
      'child-src': "'none'",
      'worker-src': "'none'",
      'manifest-src': "'none'",
      'form-action': "'none'",
      'base-uri': "'none'",
    });
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).toContain('<meta http-equiv="x-dns-prefetch-control" content="off">');
  });

  it('allows exactly its own inline script, by hash', () => {
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
    const executable = scripts.filter(([, attributes]) => !/type="application\/json"/.test(attributes));
    expect(executable).toHaveLength(1);
    expect(executable[0][1]).toBe('');
    const hash = createHash('sha256').update(executable[0][2], 'utf8').digest('base64');
    expect(directives['script-src']).toBe(`'sha256-${hash}'`);
  });

  it('references no external resources', () => {
    const head = html.slice(0, html.indexOf('<body>'));
    const attributes = [...head.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((match) => match[1]);
    expect(attributes).toHaveLength(1);
    attributes.forEach((value) => expect(value).toMatch(/^data:image\/svg\+xml,/));
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
    expect(style).not.toMatch(/@import|url\(\s*['"]?(?!data:|#)/i);
  });
});

describe('the Python fallback has no way to reach the network', () => {
  it('imports only local modules', () => {
    const text = fs.readFileSync(path.join(SKILL, 'scripts/viewer.py'), 'utf8');
    const modules = [...text.matchAll(/^\s*(?:import|from)\s+([\w.]+)/gm)].map((match) => match[1]).sort();
    expect(modules).toEqual(['argparse', 'hashlib', 'json', 'os', 'pathlib', 're', 'stat', 'sys', 'tempfile', 'time']);
  });
});

describe('the repository holds no secret-shaped strings', () => {
  // Beyond the formats looksLikeSecret knows: credentials written into connection strings.
  const CONNECTION_SECRETS = /\b(?:password|pwd|accountkey|sharedaccesskey)\s*=\s*[^;\s'"`$]{6,}/i;
  // What generic password detectors (GitGuardian's "Generic Password" and "Username Password")
  // report: a literal value given to a password-like name, directly ("password": "…",
  // DB_PASSWORD=…) or as a setting ({"name": "DB_PASSWORD", "value": "…"}). Placeholders such as
  // ${…}, <…>, *** or [REDACTED] are fine; bare values count only outside code. A name counts as a
  // whole word: DB_PASSWORD, user_password, dbPassword, passwords or pwd, but not minipass or passport.
  const NAME = String.raw`(?<![\w.-])(?:[A-Za-z0-9]+[_.-])*(?:[A-Za-z0-9]*[a-z0-9](?=P))?(?:[Pp]ass(?:word|wd|phrase)?|PASS(?:WORD|WD|PHRASE)?|[Pp]wd|PWD)(?:s|S|\d)*(?:[_.-][A-Za-z0-9]+)*`;
  const NOT_PLACEHOLDER = String.raw`(?![$<{%*]|\[REDACTED\])`;
  const QUOTED_PASSWORD = new RegExp(String.raw`${NAME}["']?\s*[:=]\s*\[?\s*["']${NOT_PLACEHOLDER}[^"'\s]{4,}`);
  // A username given a literal, and a password-like name given one (even a short one, or in a list)
  // on the same line or the next two, as in a record holding a user's name and old passwords.
  const USERNAME_PASSWORD = new RegExp(
    String.raw`^[^\n]*?(?<![\w.-])(?:[Uu]ser(?:_?[Nn]ame)?|USER(?:_?NAME)?|[Ll]ogin)["']?\s*[:=]\s*["'][^"'\s]{2,}["'][\s\S]{0,200}?${NAME}["']?\s*[:=]\s*\[?\s*["']${NOT_PLACEHOLDER}[^"'\s]{3,}`
  );
  const BARE_PASSWORD = new RegExp(String.raw`^\s*["']?${NAME}["']?\s*[:=]\s*${NOT_PLACEHOLDER}[^\s"'#,;]{4,}`);
  const PASSWORD_SETTING = new RegExp(String.raw`["']${NAME}["']\s*,\s*["']?\w*[Vv]alue["']?\s*:\s*["']${NOT_PLACEHOLDER}[^"'\s]{4,}`);
  const CODE = /\.(?:[cm]?jsx?|tsx?|py)$/;

  // Whether the username/password pair starts on line `index` (and ends within the next two lines).
  const pairShaped = (lines, index) => USERNAME_PASSWORD.test(lines.slice(index, index + 3).join('\n'));

  const secretShaped = (line, file = 'notes.txt') =>
    looksLikeSecret(line) ||
    CONNECTION_SECRETS.test(line) ||
    QUOTED_PASSWORD.test(line) ||
    PASSWORD_SETTING.test(line) ||
    (!CODE.test(file) && BARE_PASSWORD.test(line));

  it('recognizes the password shapes that secret scanners report', () => {
    const fake = FAKE.password;
    [
      `"password": "${fake}"`,
      `{ user_password: '${fake}' }`,
      `dbPassword: '${fake}'`,
      `DB_PASSWORD="${fake}"`,
      `password: ${fake}`,
      `{"name": "DB_PASSWORD", "value": "${fake}"}`,
      `{ ParameterKey: 'DbPassword', ParameterValue: '${fake}-cfn' }`,
    ].forEach((line) => expect([line, secretShaped(line)]).toEqual([line, true]));
    [
      '"password": "[REDACTED]"',
      '"password": "***"',
      "'password': 'x'",
      'password: <your password>',
      '"passwords": ["a", "b"]',
      '{"password": false}',
      '"minipass": "^7.1.2"',
      '"passport": "X1234567"',
    ].forEach((line) => expect([line, secretShaped(line)]).toEqual([line, false]));
    expect(secretShaped('password: FAKE.password', 'a.test.js')).toBe(false);
    expect(secretShaped(`"passwords": ["${fake}-1", "${fake}-2"]`)).toBe(true);
  });

  it('recognizes a username and a password given together', () => {
    const fake = FAKE.password;
    const user = ['user', 'name'].join('');
    const pair = (text) => pairShaped(text.split('\n'), 0);
    expect(pair(`{ ${user}: 'admin',\n  passwords: ['${fake}-1', '${fake}-2'] }`)).toBe(true);
    expect(pair(`{"${user}": "ada", "pwd": "${fake}"}`)).toBe(true);
    expect(pair(`{ ${user}: 'admin', value: FAKE.password }`)).toBe(false);
    expect(pair(`{ ${user}: 'admin' }\n\n\n{ password: '${fake}' }`)).toBe(false);
  });

  it('has none in any tracked file, so secret scanners have nothing to report', () => {
    let files;
    try {
      files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
    } catch {
      return; // Not a git checkout (a copy of the skill): nothing to check.
    }
    const found = [];
    files.forEach((file) => {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      if (text.includes('\u0000')) return;
      const lines = text.split('\n');
      lines.forEach((line, index) => {
        if (secretShaped(line, file) || pairShaped(lines, index)) found.push(`${file}:${index + 1}`);
      });
    });
    // Fake credentials for tests come from src/cli/testing/fakeSecrets.js, built at run time.
    expect(found).toEqual([]);
  });
});

describe('the bundle end to end', () => {
  it('runs as a program and reports its version', () => {
    expect(execFileSync(process.execPath, [BUNDLE, '--version'], { encoding: 'utf8' })).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it('exits quietly when its output is closed early', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'je-pipe-'));
    try {
      fs.writeFileSync(path.join(dir, 'big.json'), JSON.stringify(Array.from({ length: 20000 }, (_, index) => ({ index }))));
      const result = spawnSync('sh', ['-c', `"${process.execPath}" "${BUNDLE}" format big.json | head -c 10`], { cwd: dir, encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('[\n  {\n    ');
      expect(result.stderr).toBe('');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
