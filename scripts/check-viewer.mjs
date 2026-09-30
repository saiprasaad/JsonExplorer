#!/usr/bin/env node
/*
 * Checks the offline viewer pages in a real browser (Chromium via Playwright):
 *   - explore and diff pages render and respond (graph, tree, details, convert, export, filters);
 *   - they make no network request at all, trigger no Content Security Policy violation, keep
 *     nothing in browser storage, and never run code smuggled into the data.
 *
 * Usage: node scripts/check-viewer.mjs            (needs Playwright with Chromium installed)
 * Set PLAYWRIGHT_MODULE to the path of playwright's index.mjs if it is installed elsewhere.
 */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'plugins/json-explorer/skills/json-explorer/scripts/json-explorer.mjs');

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright'];
  try {
    candidates.push(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright/index.mjs'));
  } catch {
    // npm is not available; rely on the other candidates.
  }
  for (const candidate of candidates.filter(Boolean)) {
    try {
      return await import(candidate);
    } catch {
      // Try the next place.
    }
  }
  throw new Error('Playwright is not installed. Install it (npm i -g playwright && npx playwright install chromium) or set PLAYWRIGHT_MODULE.');
}

const HOSTILE = '</script><script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 2">';
const DOCUMENT = {
  name: HOSTILE,
  id: 'ID',
  price: 1.5,
  logo: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
  site: 'https://example.com/should-never-load',
  users: Array.from({ length: 30 }, (_, index) => ({ id: index, email: `u${index}@example.com`, tags: ['a', 'b'].slice(0, index % 3) })),
};

function writeFixtures(dir) {
  const text = JSON.stringify(DOCUMENT, null, 2).replace('"ID"', '12345678901234567890').replace('"price": 1.5', '"price": 1.50');
  fs.writeFileSync(path.join(dir, 'data.json'), text);
  fs.writeFileSync(path.join(dir, 'after.json'), text.replace('12345678901234567890', '12345678901234567891').replace('"u3@example.com"', JSON.stringify(HOSTILE)));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"level":"info","n":1}\n{"level":"error","n":2}\n');
  // Explicit outputs keep the pages in the scratch folder (by default they go to the user's pages folder).
  execFileSync(process.execPath, [CLI, 'explore', 'data.json', '-o', 'data.explorer.html'], { cwd: dir });
  execFileSync(process.execPath, [CLI, 'explore', 'events.jsonl', '--view', 'tree', '-o', 'events.explorer.html'], { cwd: dir });
  try {
    execFileSync(process.execPath, [CLI, 'diff', 'data.json', 'after.json', '--html', 'after.diff.html'], { cwd: dir });
  } catch (error) {
    if (error.status !== 1) throw error; // 1 means "different", as expected
  }
}

async function main() {
  const { chromium } = await loadPlaywright();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'je-viewer-check-'));
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
    console.log(`${condition ? '✓' : '✗'} ${message}`);
  };
  writeFixtures(dir);
  const browser = await chromium.launch();
  try {
    for (const [file, scheme] of [
      ['data.explorer.html', 'dark'],
      ['events.explorer.html', 'light'],
      ['after.diff.html', 'light'],
    ]) {
      const context = await browser.newContext({ colorScheme: scheme, acceptDownloads: true, viewport: { width: 1280, height: 860 } });
      const page = await context.newPage();
      const url = `file://${path.join(dir, file)}`;
      const requests = [];
      const problems = [];
      context.on('request', (request) => requests.push(request.url()));
      page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));
      page.on('pageerror', (error) => problems.push(error.message));
      page.on('dialog', (dialog) => {
        problems.push(`unexpected dialog: ${dialog.message()}`);
        dialog.dismiss();
      });
      await page.addInitScript(() => {
        window.__violations = [];
        document.addEventListener('securitypolicyviolation', (event) => window.__violations.push(`${event.violatedDirective} ${event.blockedURI}`));
      });
      await page.goto(url);
      console.log(`\n${file}`);

      if (file === 'data.explorer.html') {
        await page.waitForSelector('.react-flow__node', { timeout: 20000 });
        check((await page.title()) === `data.json · JSON Explorer`, 'title names the file');
        check((await page.locator('.react-flow__node').count()) > 3, 'graph shows nodes');
        await page.locator('.je-row', { hasText: 'id' }).first().click();
        await page.waitForSelector('.je-details');
        check((await page.locator('.je-details').innerText()).includes('12345678901234567890'), 'details show the exact 64-bit id');
        await page.locator('.je-breadcrumbs').getByRole('button', { name: 'root' }).click();
        await page.locator('.je-details').getByRole('button', { name: /Convert/ }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'YAML' }).click();
        const yaml = await page.getByRole('dialog').innerText();
        check(yaml.includes('price: 1.50') && yaml.includes('id: 12345678901234567890'), 'conversion keeps 1.50 and the 64-bit id exactly');
        await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 20000 }),
          (async () => {
            await page.getByRole('button', { name: /Export/ }).click();
            await page.getByRole('menuitem', { name: /PNG/ }).click();
          })(),
        ]);
        check((await download.suggestedFilename()).endsWith('.png'), 'graph exports as PNG');
        await page.keyboard.press('Alt+2');
        await page.waitForSelector('.je-tree-row');
        check((await page.locator('.je-tree-row').count()) > 5, 'tree view lists rows');
        await page.keyboard.press('/');
        await page.keyboard.type('u29@');
        await page.waitForTimeout(300);
        check((await page.locator('.je-tree .je-search-count').innerText()) === '1 / 1', 'search finds a value');
        const nameShown = await page.evaluate(() => document.body.innerText.includes('</script><script>'));
        check(nameShown, 'hostile strings are shown as text');
      } else if (file === 'events.explorer.html') {
        await page.waitForSelector('.je-tree-row', { timeout: 20000 });
        check((await page.locator('.je-tree-row').count()) >= 3, 'JSON Lines records open in the tree view');
      } else {
        await page.waitForSelector('.je-diff-row', { timeout: 20000 });
        check((await page.locator('.je-diff-row').count()) === 2, 'diff lists both differences');
        check((await page.locator('.je-diffview-detail').innerText()).includes('12345678901234567891'), 'diff shows exact values');
        await page.getByRole('button', { name: /Changed/ }).click();
        await page.keyboard.press('/');
        await page.keyboard.type('users');
        check((await page.locator('.je-diff-row').count()) === 1, 'diff filters by path');
      }

      await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click();
      const state = await page.evaluate(() => ({ pwned: window.__pwned ?? null, violations: window.__violations, storage: localStorage.length + sessionStorage.length }));
      check(requests.length === 1 && requests[0] === url, `no network requests (${requests.length - 1} besides the page itself)`);
      check(state.violations.length === 0, `no CSP violations${state.violations.length ? `: ${state.violations.join(', ')}` : ''}`);
      check(state.pwned === null, 'no injected code ran');
      check(state.storage === 0, 'nothing stored in the browser');
      check(problems.length === 0, `no errors${problems.length ? `: ${problems.join(' | ')}` : ''}`);
      await context.close();
    }
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} check(s) failed.` : '\nAll viewer checks passed.');
  return failures.length ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error.message);
    process.exitCode = 1;
  }
);
