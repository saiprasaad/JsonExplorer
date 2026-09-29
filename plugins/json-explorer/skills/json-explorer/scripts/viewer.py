#!/usr/bin/env python3
"""Offline viewer pages without Node.js: a fallback for `json-explorer explore` and `diff --html`.

Usage:
  python3 viewer.py explore <file> [-o <page.html>] [--view graph|tree] [--title <text>] [--jsonl | --jsonc | --strict] [--force]
  python3 viewer.py diff <before> <after> [-o <page.html>] [--ignore <jsonpath>]... [--array-match align|index] [--jsonl | --jsonc | --strict]

Reads JSON, JSONC (comments, trailing commas) or JSON Lines ("-" reads stdin) and writes one
self-contained HTML page, readable only by you: by default in a private folder in your user
cache (…/json-explorer/pages, or JSON_EXPLORER_PAGES), outside any project, where pages older
than a week are deleted. The page shows the data in your browser; its Content Security Policy
blocks every network request, and this script makes none either.

Exit status: 0 success, 2 error.
"""

import argparse
import hashlib
import json
import os
import pathlib
import re
import stat
import sys
import tempfile
import time

VERSION = "1.0.0"
DATA_MARKER = "/*JSON_EXPLORER_DATA*/"
TITLE_MARKER = "__JSON_EXPLORER_TITLE__"
TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "viewer.html")
JSONL_FILES = re.compile(r"\.(jsonl|ndjson|jsonlines)$", re.IGNORECASE)
# The same list as JSONC_FILES in src/cli/documents.js.
JSONC_FILE_PATTERN = r"(\.jsonc|(^|[\\/])(tsconfig|jsconfig)(\.[\w.-]+)?\.json|(^|[\\/])\.vscode[\\/][^\\/]+\.json|(^|[\\/])\.?devcontainer(-feature)?\.json|(^|[\\/])\.eslintrc\.json|(^|[\\/])(deno|turbo|biome|tslint|typedoc|api-extractor|nx|\.?cspell|\.markdownlint|\.oxlintrc|babel\.config|\.babelrc)\.json|(^|[\\/])(Code|Code - Insiders|VSCodium|Cursor|Windsurf)[\\/]User[\\/].+\.json|(^|[\\/])zed[\\/](settings|keymap|tasks)\.json|(^|[\\/])LocalState[\\/]settings\.json)$"
JSONC_FILES = re.compile(JSONC_FILE_PATTERN, re.IGNORECASE)
# Whitespace and line breaks exactly as jsonc-parser (VS Code's JSONC parser) accepts them.
JSONC_SPACE = " \t\r\n"
LINE_BREAK = re.compile(r"[\r\n]")
BARE_TOKEN = re.compile(r"[^\s,:\[\]{}\"/]+")
PAGE_SUFFIX = re.compile(r"\.(jsonl|ndjson|jsonlines|jsonc|json|geojson)$", re.IGNORECASE)
PAGE_NAME = re.compile(r"\.(explorer|diff)\.html$")
KEEP_PAGES_SECONDS = 7 * 24 * 60 * 60
SOFT_LIMIT = 50 * 1024 * 1024
HARD_LIMIT = 200 * 1024 * 1024
MAX_INPUT = 512 * 1024 * 1024


class Failure(Exception):
    """An error to report to the user (exit status 2)."""


def plural(count, noun):
    return f"{count:,} {noun}{'' if count == 1 else 's'}"


def format_bytes(size):
    for unit, factor in (("GB", 1024**3), ("MB", 1024**2), ("KB", 1024)):
        if size >= factor:
            return f"{size / factor:.1f} {unit}"
    return f"{size} B"


# ─── Reading ───


def read_bytes(file):
    if file == "-":
        data = sys.stdin.buffer.read(MAX_INPUT + 1)
    else:
        if os.path.isdir(file):
            raise Failure(f"{file} is a directory, not a file.")
        try:
            with open(file, "rb") as handle:
                data = handle.read(MAX_INPUT + 1)
        except FileNotFoundError:
            raise Failure(f"{file}: no such file.") from None
        except OSError as error:
            raise Failure(f"Cannot read {file}: {error.strerror or error}") from None
    if len(data) > MAX_INPUT:
        raise Failure(f"{display_name(file)} is over the {MAX_INPUT // 1024 // 1024} MB limit for one page.")
    return data


def decode(data, name):
    if data[:2] == b"\xff\xfe":
        return data[2:].decode("utf-16-le", errors="replace")
    if data[:2] == b"\xfe\xff":
        return data[2:].decode("utf-16-be", errors="replace")
    body = data[3:] if data[:3] == b"\xef\xbb\xbf" else data
    if b"\x00" in body[:8192]:
        raise Failure(f"{name} is not a text file (it contains binary data).")
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        raise Failure(f"{name} is not valid UTF-8 text.") from None


def dialect_of(name, args):
    if args.jsonl:
        return "jsonl"
    if args.jsonc:
        return "jsonc"
    if args.strict:
        return "json"
    if JSONL_FILES.search(name):
        return "jsonl"
    if JSONC_FILES.search(name):
        return "jsonc"
    return "json"


def reject_constant(name):
    raise ValueError(f"{name} is not valid JSON")


def check_json(text):
    """Raises ValueError (with a position) if `text` is not strict JSON."""
    try:
        json.loads(text, parse_constant=reject_constant)
    except RecursionError:
        pass  # Nested deeper than Python can check; the page reports any problem itself.


def jsonc_to_json(text):
    """JSONC to compact JSON: drops comments, insignificant whitespace and trailing commas."""
    out = []
    i = 0
    n = len(text)
    value_ended = False
    pending_comma = False
    while i < n:
        c = text[i]
        if c in JSONC_SPACE:
            i += 1
        elif text.startswith("//", i):
            end = LINE_BREAK.search(text, i)
            i = n if end is None else end.start()
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            if end < 0:
                raise ValueError("unterminated comment")
            i = end + 2
        elif c == ",":
            if pending_comma or not value_ended:
                raise ValueError("unexpected comma")
            pending_comma = True
            value_ended = False
            i += 1
        else:
            if pending_comma and c not in "]}":
                out.append(",")
            pending_comma = False
            if value_ended and c not in "]}:":
                raise ValueError("expected ',' between values")
            if c == '"':
                j = i + 1
                while j < n and text[j] != '"':
                    j += 2 if text[j] == "\\" else 1
                if j >= n:
                    raise ValueError("unterminated string")
                out.append(text[i : j + 1])
                i = j + 1
                value_ended = True
            elif c in "{[":
                out.append(c)
                i += 1
                value_ended = False
            elif c in "}]":
                out.append(c)
                i += 1
                value_ended = True
            elif c == ":":
                out.append(c)
                i += 1
                value_ended = False
            else:
                if value_ended:
                    raise ValueError("expected ',' between values")
                match = BARE_TOKEN.match(text, i)
                if not match:
                    raise ValueError(f"unexpected character {c!r}")
                out.append(match.group(0))
                i = match.end()
                value_ended = True
    if pending_comma:
        raise ValueError("unexpected comma at the end")
    return "".join(out)


def load(file, args):
    """Returns (name, dialect, json_text, byte_count, skipped_lines) for one input file."""
    name = display_name(file)
    data = read_bytes(file)
    text = decode(data, name)
    dialect = dialect_of(name if file == "-" else file, args)
    skipped = []
    if dialect == "jsonl":
        records = []
        for number, line in enumerate(re.split(r"\r?\n", text), start=1):
            if not line.strip(" \t\r\n"):
                continue
            try:
                check_json(line)
            except ValueError as error:
                skipped.append((number, str(error)))
                continue
            records.append(line.strip(" \t\r\n"))
        return name, dialect, "[" + ",\n".join(records) + "]", len(data), skipped
    if not text.strip(" \t\r\n"):
        raise Failure(f"{name} is empty.")
    try:
        if dialect == "jsonc":
            text = jsonc_to_json(text)
        check_json(text)
    except ValueError as error:
        label = "JSON with comments" if dialect == "jsonc" else "JSON"
        raise Failure(f"{name} is not valid {label}: {error}. Run `json-explorer validate {name}` for details, or `repair` to fix it.") from None
    return name, dialect, text, len(data), skipped


def display_name(file):
    return "stdin" if file == "-" else os.path.basename(file)


# ─── Writing ───


def embed_json(payload):
    """The payload as JSON that can sit inside a <script> element without ending it."""
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    for char, escape in (("<", "\\u003c"), (">", "\\u003e"), ("&", "\\u0026"), ("\u2028", "\\u2028"), ("\u2029", "\\u2029")):
        text = text.replace(char, escape)
    return text


def build_page(payload, title):
    try:
        with open(TEMPLATE, encoding="utf-8") as handle:
            template = handle.read()
    except OSError:
        raise Failure(f"The viewer template is missing ({os.path.normpath(TEMPLATE)}). Reinstall the JSON Explorer skill.") from None
    if template.count(DATA_MARKER) != 1 or template.count(TITLE_MARKER) != 1:
        raise Failure("The viewer template is damaged (missing placeholders). Reinstall the JSON Explorer skill.")
    # Both placeholders are filled in one pass, so inserted text is never replaced again.
    places = sorted([(template.index(TITLE_MARKER), TITLE_MARKER, escape_html(title)), (template.index(DATA_MARKER), DATA_MARKER, embed_json(payload))])
    page = []
    cursor = 0
    for at, marker, text in places:
        page.append(template[cursor:at])
        page.append(text)
        cursor = at + len(marker)
    page.append(template[cursor:])
    return "".join(page)


def escape_html(text):
    return "".join({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}.get(char, char) for char in text)


def pages_folder():
    """The private folder for pages: in the user cache, outside any project (JSON_EXPLORER_PAGES overrides it)."""
    override = os.environ.get("JSON_EXPLORER_PAGES")
    if override:
        return os.path.abspath(override)
    home = os.path.expanduser("~")
    if sys.platform == "darwin":
        cache = os.path.join(home, "Library", "Caches")
    elif sys.platform == "win32":
        cache = os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local")
    else:
        xdg = os.environ.get("XDG_CACHE_HOME", "")
        cache = xdg if os.path.isabs(xdg) else os.path.join(home, ".cache")
    return os.path.join(cache, "json-explorer", "pages")


def default_output(file, suffix):
    folder = pages_folder()
    if file == "-":
        return os.path.join(folder, f"stdin.{suffix}.html")
    absolute = os.path.abspath(file)
    base = PAGE_SUFFIX.sub("", os.path.basename(absolute))
    tag = hashlib.sha256(absolute.encode("utf-8", "surrogatepass")).hexdigest()[:8]
    return os.path.join(folder, f"{base}.{tag}.{suffix}.html")


def prepare_pages_folder(folder):
    """Creates the pages folder for the owner only, checks it is a real folder of theirs, and deletes week-old pages."""
    os.makedirs(folder, mode=0o700, exist_ok=True)
    info = os.lstat(folder)
    if not stat.S_ISDIR(info.st_mode) or (hasattr(os, "getuid") and info.st_uid != os.getuid()):
        raise Failure(f"{folder} is not a private folder of yours; set JSON_EXPLORER_PAGES to another folder, or write the page with -o.")
    if info.st_mode & 0o077:
        os.chmod(folder, 0o700)
    now = time.time()
    try:
        for name in os.listdir(folder):
            path = os.path.join(folder, name)
            entry = os.lstat(path)
            if PAGE_NAME.search(name) and stat.S_ISREG(entry.st_mode) and now - entry.st_mtime > KEEP_PAGES_SECONDS:
                os.unlink(path)
    except OSError:
        pass  # Old pages stay until the next run.


def inside_git_repository(path):
    folder = os.path.dirname(path)
    while True:
        if os.path.exists(os.path.join(folder, ".git")):
            return True
        parent = os.path.dirname(folder)
        if parent == folder:
            return False
        folder = parent


def write_page(target, page, inputs=()):
    """Writes atomically, readable only by the owner: the page contains the data."""
    destination = os.path.realpath(target)
    private = os.path.dirname(os.path.abspath(target)) == pages_folder()
    for source in inputs:
        if source != "-" and os.path.exists(source) and os.path.realpath(source) == destination:
            raise Failure(f"Refusing to write over the input {target}; choose another output file.")
    if private:
        prepare_pages_folder(os.path.dirname(destination))
    try:
        if os.path.exists(destination) and not os.path.isfile(destination) and not os.path.isdir(destination):
            # /dev/null or a pipe: write to it directly.
            with open(destination, "w", encoding="utf-8", newline="") as stream:
                stream.write(page)
        else:
            directory = os.path.dirname(destination) or "."
            handle, temporary = tempfile.mkstemp(prefix=f".{os.path.basename(destination)}.", suffix=".tmp", dir=directory)
            try:
                with os.fdopen(handle, "w", encoding="utf-8", newline="") as stream:
                    stream.write(page)
                os.chmod(temporary, 0o600)
                os.replace(temporary, destination)
            except OSError:
                try:
                    os.unlink(temporary)
                except OSError:
                    pass
                raise
    except OSError as error:
        raise Failure(f"Cannot write {target}: {error.strerror or error}") from None
    try:
        shown = os.path.relpath(destination)
    except ValueError:  # on another drive (Windows)
        shown = destination
    if shown.startswith(".."):
        shown = destination
    print(f"Wrote {shown} ({format_bytes(len(page.encode('utf-8')))}, readable only by you).")
    print(f"Open it in any web browser: {pathlib.Path(destination).as_uri()}")
    print("It works offline: the data is inside the page, and the page makes no network requests.")
    if not private and inside_git_repository(destination):
        print(f"Note: {shown} is inside a git repository and holds all of the data: keep it out of commits (for example, list it in .gitignore).", file=sys.stderr)


def note_skipped(skipped):
    if skipped:
        number, message = skipped[0]
        print(f"Note: {plural(len(skipped), 'invalid line')} skipped (first at line {number}: {message}).", file=sys.stderr)


# ─── Commands ───


def explore(args):
    if args.view not in ("graph", "tree"):
        raise Failure('--view expects "graph" or "tree".')
    name, dialect, text, size, skipped = load(args.file, args)
    encoded = len(text.encode("utf-8"))
    if encoded > HARD_LIMIT and not args.force:
        raise Failure(f"{name} is {format_bytes(encoded)}; pages this large may not open in a browser. Use --force to write it anyway.")
    payload = {"kind": "document", "name": name, "text": text, "dialect": dialect, "view": args.view, "bytes": size, "generator": f"JSON Explorer {VERSION}"}
    write_page(args.out or default_output(args.file, "explorer"), build_page(payload, args.title or f"{name} · JSON Explorer"), [args.file])
    note_skipped(skipped)
    if encoded > SOFT_LIMIT:
        print(f"Note: the document is {format_bytes(encoded)}, so the page may take a while to open.", file=sys.stderr)


def diff(args):
    if args.before == "-" and args.after == "-":
        raise Failure("Only one side of a diff can be read from stdin.")
    if args.array_match not in ("align", "unordered", "index"):
        raise Failure('--array-match expects "align", "unordered" or "index".')
    sides = []
    for file in (args.before, args.after):
        name, _, text, _, skipped = load(file, args)
        if skipped:
            raise Failure(f"{name} has {plural(len(skipped), 'invalid line')} (first at line {skipped[0][0]}: {skipped[0][1]}).")
        sides.append({"name": name, "text": text})
    payload = {"kind": "diff", "left": sides[0], "right": sides[1], "ignore": args.ignore, "arrays": args.array_match, "generator": f"JSON Explorer {VERSION}"}
    title = f"{sides[0]['name']} → {sides[1]['name']} · JSON Explorer"
    write_page(args.out or default_output(args.after, "diff"), build_page(payload, title), [args.before, args.after])
    print("The page compares the documents when it opens (key order and formatting are ignored).")


def parser():
    root = argparse.ArgumentParser(prog="viewer.py", description="Offline JSON viewer pages (no network).")
    commands = root.add_subparsers(dest="command", required=True)
    for command in ("explore", "diff"):
        sub = commands.add_parser(command)
        if command == "explore":
            sub.add_argument("file")
            sub.add_argument("--view", default="graph")
            sub.add_argument("--title")
            sub.add_argument("--force", action="store_true")
        else:
            sub.add_argument("before")
            sub.add_argument("after")
            sub.add_argument("--ignore", action="append", default=[])
            sub.add_argument("--array-match", default="align")
        sub.add_argument("-o", "--out")
        dialect = sub.add_mutually_exclusive_group()
        dialect.add_argument("--jsonl", action="store_true")
        dialect.add_argument("--jsonc", action="store_true")
        dialect.add_argument("--strict", action="store_true")
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        (explore if args.command == "explore" else diff)(args)
    except Failure as failure:
        print(f"Error: {failure}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
