# JSONPath and JSON Pointer in JSON Explorer

`query`, `outline --path`, `convert --path` and `diff --ignore` take a **JSONPath** (RFC 9535, the IETF standard) or a **JSON Pointer** (RFC 6901). The implementation passes the full official JSONPath Compliance Test Suite.

## Contents

- [Shell quoting](#shell-quoting)
- [Selectors](#selectors)
- [Filters](#filters)
- [Functions](#functions)
- [Recipes](#recipes)
- [JSON Lines](#json-lines)
- [JSON Pointer](#json-pointer)
- [Coming from jq or older JSONPath](#coming-from-jq-or-older-jsonpath)

## Shell quoting

Put the whole path in **single quotes** so the shell leaves `$`, `*`, `?`, `!` and `[ ]` alone, and write string literals inside it with **double quotes**:

```bash
json-explorer query data.json '$.users[?@.role == "admin"].email'
```

RFC 9535 accepts both quote styles for string literals, so `"admin"` and `'admin'` mean the same thing. If a key contains a single quote, use a double-quoted name: `'$["it'\''s"]'` in bash, or wrap the whole path in double quotes and escape `$` as `\$`.

## Selectors

| Path | Selects |
|---|---|
| `$` | the whole document |
| `$.store.name` | a member by name |
| `$['first name']`, `$["user.name"]` | names with spaces, dots or other special characters |
| `$.items[0]`, `$.items[-1]` | an array item by index; negative indexes count from the end |
| `$.items[0:10]`, `$.items[:3]`, `$.items[5:]` | a slice (end excluded) |
| `$.items[::2]`, `$.items[::-1]` | every second item, all items in reverse |
| `$.items[0,3,-1]`, `$['a','b']` | several selectors at once (a union) |
| `$.store.*`, `$.items[*]` | every member or item |
| `$..price` | `price` at any depth (descendants) |
| `$..*` | every value below the root |

Results come in document order, each with its normalized path (for example `$.items[3].name` or `$["first name"]`).

## Filters

`[?<expression>]` keeps the members or items for which the expression is true. `@` is the current item and `$` is the document root.

| Filter | Keeps items where… |
|---|---|
| `[?@.price > 10]` | price is a number above 10 (`==`, `!=`, `<`, `<=`, `>`, `>=`) |
| `[?@.status == "active"]` | status is exactly the string `active` |
| `[?@.email]` | the item has an `email` member (any value, including null) |
| `[?!@.email]` | the item has no `email` member |
| `[?@.price > 10 && @.stock > 0]`, `[?@.a \|\| @.b]` | both / either (`!` negates, parentheses group) |
| `[?@.sale < @.price]` | one field compares with another |
| `[?@.price > $.threshold]` | a field compares with a value elsewhere in the document |
| `[?@.items[?@.qty > 5]]` | a nested query finds at least one match |
| `[?@.shipping == @.billing]` | two members are equal (arrays and objects compare deeply) |
| `[?@ > 3]` | on arrays of plain values, `@` is the value itself |

Literals are numbers, strings, `true`, `false` and `null`; there are no array or object literals, so compare with another member (as above) instead. Comparisons follow the standard: values of different types are never less or greater than each other, and a missing member compares equal only to another missing member. That's why `[?@.price > 10]` quietly skips items without a price.

## Functions

| Function | Meaning |
|---|---|
| `length(@.tags) > 3` | length of a string (in characters), array or object |
| `count(@.items[*]) > 1` | number of nodes a query selects |
| `match(@.sku, "A-[0-9]+")` | the whole string matches the regular expression |
| `search(@.msg, "[Tt]imeout")` | some part of the string matches |

`match()` and `search()` run the pattern with JavaScript's regular expression engine, which backtracks: a pattern with nested repetition such as `(a+)+b` or `(a|a)*c` can take very long on a long string. Keep patterns simple.
| `value(@..id) == 5` | the single value a query selects (no match or several matches give nothing) |

The regular expressions are I-Regexp (RFC 9485): character classes, `\p{L}` style Unicode categories, quantifiers, alternation and groups. It has no backreferences, lookaround or inline flags such as `(?i)`, so write `[Tt]imeout` for a case-insensitive match. `.` matches any character except line breaks.

## Recipes

```bash
json-explorer query data.json '$..email'                                  # every email, anywhere
json-explorer query data.json '$..email' --count                          # just how many
json-explorer query data.json '$.users[?!@.email].id'                     # users without an email
json-explorer query data.json '$.orders[?@.total > 100 && @.status == "paid"].id'
json-explorer query data.json '$.orders[?@.items[?@.qty > 5]].id'         # orders with a big line item
json-explorer query data.json '$.posts[?length(@.tags) > 3].title'
json-explorer query data.json '$.items[-1]'                               # the last item
json-explorer query data.json '$.items[:10].name' --values                # first ten names, one per line
json-explorer query data.json '$.items[*].name' --raw > names.txt         # plain strings, no quotes
json-explorer query data.json '$.data' -o data-only.json                  # extract a part as its own file
json-explorer query data.json '$..id' --paths                             # where the ids are, not what they are
json-explorer query data.json '$..createdAt' '$..updatedAt' --limit 5    # several paths at once
json-explorer diff a.json b.json --ignore '$..updatedAt' --ignore '$.meta.requestId'
json-explorer outline data.json --path '$.results[*]'                     # structure of one part
json-explorer convert data.json --path '$.results[*]' --to csv -o results.csv
```

## JSON Lines

For `.jsonl` and `.ndjson` files (or with `--jsonl`), `$` is the list of records:

```bash
json-explorer query app.jsonl '$[?@.level == "error"]' --count
json-explorer query app.jsonl '$[?@.status >= 500].path' --values --limit 0
json-explorer query app.jsonl '$[*].user.id' --paths --limit 3
json-explorer query app.jsonl '$[1000]'                                   # the 1,001st record
```

When the first step picks records one at a time (`$[*]`, `$[3]`, `$[10:20]`, or a filter such as `$[?@.level == "error"]`) and no later step refers to `$`, records are streamed, so files of any size work. An index or slice (`$[3]`, `$[10:20]`) stops reading once past the last record it can match; `$[*]` and filters read the whole file to count every match. Other queries (`$..x`, `$[-1]`, anything that uses `$` after the first step) load the whole file, up to `--max-size` (512 MB by default). Invalid lines are skipped with a note.

## JSON Pointer

A path that starts with `/` (or is empty) is a JSON Pointer: `/users/0/email` is `$.users[0].email`, and `""` is the whole document. Inside a name, `~1` means `/` and `~0` means `~`, so `/paths/~1api~1users` selects the key `/api/users`. A pointer selects at most one value.

## Coming from jq or older JSONPath

| You might write | In JSONPath (RFC 9535) |
|---|---|
| jq `.items[] \| select(.price > 10) \| .name` | `$.items[?@.price > 10].name` |
| jq `.items \| length` | `$.items[*]` with `--count`, or `length(@.items)` inside a filter |
| jq `.[] \| select(.tags \| index("x"))` | `$[?@.tags[?@ == "x"]]` |
| jq `..\|.id? // empty` | `$..id` |
| Goessner `$..book[?(@.price < 10)]` | the same works: parentheses around a filter are allowed |
| Goessner `$..book[(@.length-1)]` | `$..book[-1]` (script expressions are not supported) |
| `@.name.length` (JavaScript) | `length(@.name)` |
| `=~ /regex/` | `match()` for the whole string, `search()` for part of it |
| `in`, `contains`, `nin` | `search()`, `==`, or a nested filter as above |
