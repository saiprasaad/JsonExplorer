# JSON Explorer for Claude

A Claude skill and Claude Code plugin for working with JSON, JSONC and JSON Lines **without the data leaving your machine**: explore it as an interactive graph or tree, map its structure, query it with JSONPath, compare documents, generate TypeScript types or a JSON Schema, convert it to CSV, YAML or JSON Lines, find and fix syntax errors, and format, minify or sort it without losing big numbers.

## Install

**Claude Code**

```
/plugin marketplace add saiprasaad/JsonExplorer
/plugin install json-explorer@json-explorer
```

**Claude apps** (claude.ai, desktop): upload `json-explorer.skill` (built with `npm run package:skill` in the repository) in *Settings → Capabilities → Skills*.

**Anywhere else**: copy `skills/json-explorer/` into your skills folder (for Claude Code, `~/.claude/skills/`), or run the tool directly: `node skills/json-explorer/scripts/json-explorer.mjs --help`.

Requirements: Node.js 18 or later (numbers such as 64-bit ids and `1.50` stay exact on every version). Without Node.js, `python3 skills/json-explorer/scripts/viewer.py` still writes the viewer pages.

## What's inside

| Part | What it does |
|---|---|
| `skills/json-explorer/SKILL.md` | Tells Claude when and how to use the tool, and the privacy rules it follows |
| `skills/json-explorer/scripts/json-explorer.mjs` | The tool: one readable, dependency-free file (built from `src/cli`) |
| `skills/json-explorer/assets/viewer.html` | The offline viewer page template (built from `src/viewer`) |
| `skills/json-explorer/scripts/viewer.py` | Python fallback for the viewer pages |
| `skills/json-explorer/references/` | Every command's options, and a JSONPath guide |
| `hooks/hooks.json` | After Claude writes or edits a JSON file, reports any syntax error the edit introduced, with its location (values hidden) |

## Commands

| Command | Purpose |
|---|---|
| `explore <file>` | Writes an offline page (to a private folder, readable only by you) with an interactive graph and tree, search, details, conversions and image export |
| `outline <file>` | Maps every path with its types, presence, formats and lengths, without printing values (`--samples` and `--top` on request) |
| `query <file> <path>…` | JSONPath (RFC 9535) or JSON Pointer; streams JSON Lines of any size |
| `diff <before> <after>` | Differences by path, ignoring key order and formatting; moved list items; `--html -` writes a visual report |
| `validate <file>…` | Syntax errors with line, column and an excerpt; duplicate keys; JSON Schema (draft-06 to 2020-12) |
| `repair <file>` | Fixes quotes, commas, comments, Python literals, truncation and more (JSONC keeps its comments); `--diff` previews |
| `format`, `minify`, `sort-keys` | Lossless rewriting; JSONC comments survive formatting; `--check` for CI |
| `convert <file> --to …` | TypeScript, JSON Schema, YAML, CSV, TSV, JSON Lines or JSON |

## Privacy and security

- **No network, anywhere.** The tool imports only file-system and text modules, and a test runs every command with all networking booby-trapped. The viewer page's Content Security Policy allows only its own script (pinned by hash) and images and fonts embedded in the page itself, and blocks every request, form, frame and worker; it also turns off DNS prefetching, referrers and browser translation, and has no links out of the page. A browser test confirms the pages make no requests and store nothing.
- **Secrets stay masked.** Everything the tool prints about the data masks values under credential-like names (password, token, apiKey, secret, authorization, cookie, …) and everything below them, values of settings named like credentials (`{"name": "DB_PASSWORD", "value": …}`), and values that look like keys or tokens (AWS, GitHub, GitLab, Slack, Stripe, Google, npm, Hugging Face, SendGrid, DigitalOcean and OpenAI-style keys, JWTs, private keys, Basic/Bearer credentials, connection-string passwords, credentials in URLs, payment card numbers alone or inside text, checked against each card network's prefixes, lengths and check digit). Session ids, IBANs and card numbers are masked by name too, and tokens used as keys are masked in paths. Comparisons and functions in filters (in `query`, `diff --ignore`, `outline --path`, `convert --path`) read masked values as if they were not there, so a filter cannot confirm a guess; it can only see that the field exists, as the output shows. `--show-secrets` reveals them on request. All masking patterns run in linear time, so crafted input cannot stall the tool.
- **Error excerpts show structure, not data.** Syntax-error excerpts (from `validate`, other commands and the edit hook) hide every value and show only the keys and punctuation around the problem. Parse error messages never quote the offending text.
- **`outline` prints no values.** No strings, samples or common values unless asked (`--samples`, `--top`, never for sensitive fields, and `--top` never for a value seen only once); number ranges only for fields with at least five distinct values; maps fold into `.*` (objects keyed by ids, dates or names, and keys that change from record to record), and so does any single key that is data (an email address, a token), so none of those keys is printed. Outlining part of a document (`--path`) keeps the fields under a sensitive name hidden.
- **Pages stay private.** Viewer pages hold the whole document, so by default they go to a private per-user folder (`~/.cache/json-explorer/pages`, `~/Library/Caches/…` on macOS, `%LOCALAPPDATA%\…` on Windows; `JSON_EXPLORER_PAGES` overrides it), created readable only by you and verified to be yours, outside any project, so a page is never committed or synced with it. Pages older than a week are deleted. A page written elsewhere with `-o` gets a warning when it lands in a git repository.
- **Files stay private.** Pages are readable only by you. Files derived from an input (`-o`) never get wider permissions than the input, even when they replace an existing file, and output derived from stdin is private. No output may replace one of its inputs. Every write is atomic, through an exclusively created temporary file with an unpredictable name, so a failure never leaves a half-written file and nothing planted at that name is followed.
- **Claude reads only what it needs.** The skill tells Claude to map a file with `outline` before reading it, to query just the values it needs, to write transformed data to files instead of printing it, and never to publish a viewer page, upload data or use online tools.
- **Untrusted input is safe.** JSON is embedded in viewer pages so that no value can break out of its data block or change the page (tested against script-injection strings and values that spell the page's placeholders). Control characters in data are escaped before they reach a terminal. Pipes and devices are read with the size limit, and binary data is refused. JSON Schemas are compiled to code by Ajv, as usual for Ajv, so validate against schemas you trust.

The hook never blocks work on its own problems: if it cannot check a file (too large, binary, unreadable) it stays silent, and it says nothing about a file that was already broken before the edit or about comments in a `.json` file that already had them. Set `JSON_EXPLORER_HOOK=off` in your environment to turn it off.

## What's new in 1.1.1

Fixes from a second audit:

- **Card numbers inside text are masked** ("paid with 4111 …"), in values and comments alike. A number counts as a card only with a real card network's prefix and length, so fewer ids are mistaken for cards, and numbers under id names (`orderId`, `ids`) are left alone unless the name mentions a card.
- **`outline` folds maps keyed by names or prefixed ids** (20 or more entries of one shape, `u1001`-style keys, keys that change from record to record), merging what it had already listed, so their keys are never printed. Objects of many different settings no longer fold.
- **`outline --top` lists only values seen more than once**, so it never singles out one record; a field of unique values says "all distinct".
- **`outline --path` into a sensitive field keeps it hidden**, samples and common values included.
- **Consistent sensitivity:** only names that end in IBAN are masked (`customerIban`, not `ibanValidated`), and `outline` no longer says "values hidden" next to true/false counts, which `query` shows too.
- **A `--path` that matches nothing exits 1** in `convert` and `query -o`, as in `outline`.

## What's new in 1.1

- **Filters can't probe masked values.** A filter such as `[?@ == "guess"]`, `match()` or `length()` reads a masked value as if it were not there, so it can no longer confirm a hidden password (found in an independent audit).
- **More secrets masked:** payment card numbers (Luhn-checked), session ids, IBANs and card-number fields.
- **`outline --top N`** lists the most common values of each field with their counts. One key that is data (a token, an email address) no longer folds its siblings into `.*`.
- **Clearer `repair --diff`** for short files, and a note when comments are removed from a `.json` file.
- **`query --exit-status`** exits 1 when nothing matches. `diff` reports an item that moved and changed once, by its changes.
- **Safer defaults:** plain JSON loads up to 200 MB by default (JSON Lines stream at any size), CSV neutralises formulas after leading spaces, and JSONPath `match()`/`search()` work on Node.js 18.

## Development

The skill is built from the sources in this repository (`src/cli`, `src/viewer`):

```bash
npm run build:skill    # rebuild the files in skills/json-explorer
npm run check:skill    # fail if they are out of date
npm run test:cli       # tests, with 100% coverage enforced
npm run check:viewer   # browser check of the viewer pages (needs Playwright)
```

GitHub Actions runs all of these on every pull request, and the tool's tests on Node 18, 20 and 24 as well (`.github/workflows/ci.yml` at the repository root).

## License

MIT © 2025-2026 Saiprasaad Kalyanaraman; the full text is in `skills/json-explorer/LICENSE.txt`. The open-source packages bundled into the tool and viewer keep their own licenses, listed in `skills/json-explorer/THIRD_PARTY_NOTICES.txt`.
