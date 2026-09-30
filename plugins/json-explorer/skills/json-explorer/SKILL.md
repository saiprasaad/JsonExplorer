---
name: json-explorer
description: Private, local toolkit for JSON, JSONC and JSON Lines, with an offline interactive graph and tree viewer and a zero-dependency CLI to outline, query (JSONPath), diff, validate, repair, format and convert. Use it when the user wants to look inside, summarize or visualize JSON data (a file, API response or export, even a huge one), compare two JSON documents, count or extract values from logs and exports (.json, .jsonl, .ndjson), find out why JSON is invalid or fix it, format or minify it losslessly, or turn it into TypeScript types, JSON Schema, CSV, TSV or YAML. Not needed for small edits to config files such as package.json or tsconfig.json. It keeps 64-bit numbers and literals like 1.50 exact, streams JSON Lines of any size, masks secrets and never uses the network.
license: MIT (full text in LICENSE.txt)
compatibility: Needs Node.js 18 or later for the CLI (one bundled file, nothing to install). Python 3 alone can write the explore and diff pages. Works offline and never uses the network.
metadata:
  version: "1.1.1"
  repository: https://github.com/saiprasaad/JsonExplorer
---

# JSON Explorer

Everything in this skill runs on the user's machine. The CLI is one bundled file with no dependencies and no network code; the viewer is one HTML file whose Content Security Policy blocks every network request. That is the point of the skill: people's JSON is often an API response, an export, a log or a config full of personal data and credentials, and they need to understand it without it going anywhere.

## Running the tool

```bash
node "${CLAUDE_SKILL_DIR}/scripts/json-explorer.mjs" <command> [options]
```

`${CLAUDE_SKILL_DIR}` is the folder that contains this SKILL.md; if it was not replaced by a real path, use that folder's path. Below, `json-explorer` is short for the whole command above. Always type it out in full, and run one `json-explorer` command per call, without `&&`, `;` or pipes into other tools. Permission checks judge a call by the command they can see: each extra part of a chain may stop to ask the user, and a path hidden in a shell variable or alias gets the command blocked (variables and aliases don't carry over between calls anyway).

Every command has `--help`, and `references/commands.md` lists every option. Don't read or grep `scripts/json-explorer.mjs` or `assets/viewer.html`: they are large generated bundles, and everything you need is in `--help` and this file. Exit status: **0** success, **1** a check failed (invalid JSON, documents differ, a file would change) or a `--path` matched nothing, **2** usage or input error. Exit 1 is an answer, not a crash.

**No Node.js?** Check with `node --version` (18 or later is needed). Without it, `python3 "${CLAUDE_SKILL_DIR}/scripts/viewer.py" explore <file>` and `... diff <before> <after>` write the same offline pages. For the other tasks use Python's `json` module and keep the rules below; Python keeps big integers exact but turns `1.50` into `1.5`, so use it to read, not to rewrite files.

## Privacy rules

The user is trusting you with data that may be sensitive. These rules are what make this skill safe to use on real data, so follow them even when a shortcut looks convenient.

1. **Keep the data on the machine.** Never paste, upload or send the user's JSON, or values from it, anywhere. That rules out online validators, formatters and viewers, pastebins and gists, web searches or fetches containing values, and `curl`/`wget` with the data. The bundled tools do all of it locally.
2. **Look before you read.** Don't `cat` or read a large or unfamiliar JSON file into the conversation. Run `outline` first (it maps the structure without printing values), then `query` exactly the values you need. This keeps the context small and avoids pulling personal data into the conversation that nobody needed. Reading a small file the user pointed you at is fine.
3. **Secrets stay masked.** What the CLI prints about the data (query results, diffs, `repair --diff`) shows `[REDACTED]` for secrets: values under credential-like keys and everything below them (all of `credentials`, `passwords[0]`), the values of settings named like credentials (`{"name": "DB_PASSWORD", "value": …}`), and strings that look like keys, tokens, JWTs, private keys, connection strings, credentials in URLs or contain a payment card number; fields named like a session id or an IBAN count as credentials, and a token used as a key is masked in paths too. Filters can't test masked values either: in `query`, `diff --ignore`, `outline --path` and `convert --path`, comparisons and functions read a masked value as if it were absent (a filter still sees that the field exists, as the output shows), so `[?@.password == "..."]` matches nothing without `--show-secrets`. Error excerpts (`validate`, the edit hook) hide every value and show only the structure around the problem. `outline` prints no values unless asked, and never for sensitive fields. Add `--show-secrets` only when the user explicitly asks to see those values, and don't work around the masking with other tools.
4. **Transforms go to files.** `format`, `minify`, `sort-keys`, `repair` and `convert` print every value when they write to stdout, because their output must be exact. Write their results with `-o <file>` (or `-i` in place) instead, and show the user a short excerpt only if it helps.
5. **Viewer pages contain all the data.** `explore` and `diff --html -` write a page that only the user can read into a private folder in their user cache (outside the project, so it is never committed or synced with it; pages older than a week are deleted). The page shows every value, secrets included, because it is for the user's own eyes. Tell the user the path and the `file://` link the CLI prints. Don't read the page back (it is ~700 KB of viewer code plus the data), never `git add` or commit one, and don't publish, upload or share it (no artifacts, gists, share links or attachments) unless the user explicitly asks; if they do, remind them that it contains the whole document. If the user can only open files inside the working directory (a web or cloud session), write the page there with `-o <name>.html` and list it in `.gitignore`.
6. **Change only what the user asked for.** New files go where the user wants them. Rewrite a file in place (`-i`) only when the user asked for that file to be fixed, formatted or sorted.

## Pick the command

| The user wants to… | Run |
|---|---|
| see, visualize or browse the data | `explore <file>`, then summarize with `outline` |
| know what is in a file: structure, fields, types | `outline <file>` |
| get, count or search for specific values | `query <file> '<jsonpath>'` |
| compare two files or API responses | `diff <before> <after>` (`--html -` for a visual report) |
| TypeScript types or a JSON Schema from samples | `convert <file> --to ts` or `--to schema` |
| CSV, TSV, YAML, JSON Lines or plain JSON | `convert <file> --to csv -o out.csv` |
| know why JSON is invalid, or check it against a schema | `validate <file> [--schema schema.json]` |
| fix broken JSON | `repair <file> --diff`, then `-o fixed.json` or `-i` |
| pretty-print, minify or sort keys, or check that in CI | `format`, `minify`, `sort-keys` (`-i`, `-o`, `--check`) |

Inputs can be JSON, JSONC (comments and trailing commas, as in `tsconfig.json`, `.vscode/*.json` or `*.jsonc`; detected by name, or use `--jsonc`), JSON Lines (`*.jsonl`, `*.ndjson`, or `--jsonl`), or `-` for stdin.

## Explore: the main use

```bash
json-explorer explore data.json                  # writes the page to the private pages folder and prints its path
json-explorer explore events.jsonl --view tree   # JSON Lines become a list of records
```

Then:

1. Tell the user where the page is (the path and `file://` link the CLI printed) and that it opens in any browser, offline. If they are on their own machine and want it opened, run `open <page>` (macOS), `xdg-open <page>` (Linux) or `start "" <page>` (Windows).
2. Give a short summary from `outline` right away, so they learn something before they even open the page. For example: "1,204 orders. Each has `id`, `customer{name, email}`, `items[]` (1–14 per order) and `total` (3.20–1,840.00); `coupon` appears in 8% of orders."
3. Point out what helps with their question. The page has a graph view and a tree view and can search keys and values. Clicking any value shows its path as JSONPath, JavaScript, jq or JSON Pointer, the exact number, and a table for lists of records. It also converts, exports the graph as PNG or SVG, and has a step-by-step walkthrough and light and dark themes.

For documents over about 50 MB, the page gets slow. Explore the part the user cares about instead: `json-explorer query big.json '$.data.items' -o items.json`, then `explore items.json`.

## Outline: understand a file without reading it

```bash
json-explorer outline data.json
json-explorer outline events.jsonl --records 100000      # JSON Lines are streamed; any size works
json-explorer outline api.json --path '$.data[*]' --depth 3
```

Each row is a path (array items fold into `[*]`) with its types, how often it is present (`SEEN`), and details: key and item counts, string formats (email, date-time, uuid, uri…) and lengths, distinct counts, and number ranges for fields with at least five distinct values (fewer would all but give the values away). No values are printed unless you add `--samples N` (examples) or `--top N` (the most common values with their counts, such as how many records per language; a value seen only once is never listed); add them only when the user wants values. Sensitive fields show no samples, common values, lengths or ranges. Maps, whose keys are data (ids, dates, names) or change from record to record, fold into `.*`, and so does any single key that is data itself (an email address, a token); list a map's keys only if the user needs them, with `query <file> '$.map.*' --paths`. For JSON Lines, `--path` works on the list of records as in `query` (`--path '$[*].user'`). Use `--json` for machine-readable output.

## Query: extract exact values

```bash
json-explorer query data.json '$.users[0].email'
json-explorer query data.json '$..id' --count
json-explorer query orders.json '$.orders[?@.total > 100].customer.name' --values
json-explorer query events.jsonl '$[?@.level == "error"].message' --limit 20
json-explorer query config.json /server/port                 # a JSON Pointer works too
```

Paths are JSONPath (RFC 9535). Quote them in single quotes so the shell leaves `$` alone, and use double quotes for strings inside. Quick reference: `$.a.b`, `$['odd key']`, `[0]`, `[-1]`, `[0:5]`, `[*]`, `..name` (at any depth), filters `[?@.price > 10 && @.stock]`, and the functions `length()`, `count()`, `match()` (whole string), `search()` (substring) and `value()`. The full syntax is in `references/jsonpath.md`.

Output is `path: value`, at most 50 matches per path (`--limit N`, `0` for all). Use `--count`, `--paths`, `--values`, `--raw` (strings unquoted), `--json`, or `-o file` for the full values. Exit status is 0 even when nothing matches; add `--exit-status` to get 1 then, as with `grep`. Numbers print exactly as written, so `1.50` stays `1.50` and 64-bit ids keep every digit. When you report numbers to the user, copy them from the output rather than recomputing them. For JSON Lines, `$` is the list of records, and queries that go record by record (`$[*]...`, `$[?...]...`) stream through files of any size.

## Diff: compare two documents

```bash
json-explorer diff before.json after.json
json-explorer diff expected.json actual.json --ignore '$..updatedAt' --ignore '$.meta.requestId'
json-explorer diff old.json new.json --html -    # also writes a visual report (private pages folder), same --ignore paths
json-explorer diff a.json b.json --array-match unordered   # when the order of list items does not matter
```

Lines read `~ $.path: old → new` (changed), `+ $.path: value` (added), `- $.path: value` (removed) and `↕ $.path: value (moved from $.old)` (moved); a change inside an item that moved ends with `(was $.old.path)`. The comparison ignores key order and formatting and compares numbers by exact value (1.5 equals 1.50). Arrays are aligned like a line diff, so inserting one item is one change. Records are matched by their id (`id`, `_id`, `uuid`, `guid`, `sku`, or a key such as `productId` or `order_id`), else by `key` or `name`; an item found elsewhere in the list is reported as moved or, if it also changed, by its changes alone (each with the path it was at), and two records with different ids are reported as one removed and one added, never as an edit. `--array-match unordered` ignores moves (for lists in no particular order, such as many API results) and `--array-match index` compares position by position. Ignore volatile fields such as timestamps and request ids with `--ignore`. Explain the differences that matter to the user instead of pasting hundreds of lines. For large diffs use `--json`, the counts, or the HTML report.

## Types and schemas

```bash
json-explorer convert response.json --to ts --name ApiResponse
json-explorer convert response.json --path '$.data.items[*]' --to schema -o item.schema.json
```

Types come from every record. Fields missing from some records become optional (`?` in TypeScript, left out of `required` in the schema), mixed types become unions, and repeated object shapes become named interfaces. The schema is JSON Schema 2020-12. For JSON Lines, the types describe one record. Remind the user that inferred types only reflect the sample; for example, a field that is never null in the sample may still be nullable in the real API.

## Convert data

```bash
json-explorer convert users.json --to csv -o users.csv          # or tsv, yaml, jsonl, json
json-explorer convert events.jsonl --to csv -o events.csv
json-explorer convert api.json --path '$.results[*]' --to csv -o results.csv
```

CSV and TSV turn each record into a row and flatten nested objects into `parent.child` columns; arrays go into a cell as JSON. Cells that a spreadsheet would run as a formula are neutralised. YAML parses back to the same data, and JSON Lines writes one record per line. Numbers keep every digit.

## Validate and repair

```bash
json-explorer validate config.json                      # several files work too
json-explorer validate response.json --schema response.schema.json
json-explorer repair broken.json --diff                  # preview the fixes
json-explorer repair broken.json -o fixed.json           # or -i to fix the file itself
```

`validate` reports the first syntax error of each file with line and column, an excerpt of the structure around it (values hidden) and a plain explanation. It also warns about duplicate keys and numbers that lose precision in JavaScript, and lists JSON Schema errors (draft-06, draft-07, 2019-09 and 2020-12) by path. `repair` fixes single quotes, unquoted keys, missing or trailing commas, comments, Python `None`/`True`/`False`, `NaN`, JSONP wrappers, values on separate lines and truncated documents. For a truncated file, tell the user that data at the end may be missing. Always preview with `--diff` first, then validate the result. JSONC files (`tsconfig.json`, VS Code settings) allow comments, and `repair` keeps them; if it cannot, `-i` refuses and `-o` writes a copy without them. A plain `.json` file cannot have comments, so repairing one removes them and says so; if the file is meant to have them, repair it with `--jsonc`.

## Format, minify, sort keys

```bash
json-explorer format data.json -i                  # --indent 2 (default), 4 or tab
json-explorer sort-keys package.json --check       # exit 1 if it would change
json-explorer minify data.json -o data.min.json
```

These are lossless: numbers, string escapes and (for `format` and `minify`) key order stay exactly as written, and JSONC comments survive formatting. `sort-keys` sorts by code point, like `jq -S`. `--check` changes nothing and fails if a file would change, which suits CI.

## Things to watch

- **Big numbers.** Don't re-serialize the user's JSON through JavaScript's `JSON.parse` or Python floats. 64-bit ids and decimals like `1.50` change silently that way. The CLI keeps literals exactly, on every Node.js version.
- **Duplicate keys.** Parsers disagree on which value wins; if `validate` warns about one, tell the user.
- **Very large files.** JSON Lines stream at any size. A plain JSON document is loaded whole, which takes about ten times its size in memory, so files over 200 MB are refused unless you pass `--max-size <MB>`. Before raising it, check the machine has the memory, or pull out just the part the user needs.
- **JSON pasted into the chat.** Don't retype it by hand into a file or a command: that is slow, costly and can change it. For a short paste, answer from it or save it once with your file-writing tool and run the commands on that file. For a long one (more than a few kilobytes), ask the user to save it to a file and give you the path.
- **Edit checks.** When this skill comes with the JSON Explorer plugin for Claude Code, a hook checks every JSON file you write or edit and reports only problems your edit introduced. If it reports one, fix the file before moving on. If it says an edit added comments to a `.json` file that is meant to allow them (editor settings), leave them.

## Reference

- `references/commands.md`: every command's options, output formats and exit codes (the CLI's full `--help`).
- `references/jsonpath.md`: JSONPath and JSON Pointer syntax with examples, for queries beyond the quick reference.
