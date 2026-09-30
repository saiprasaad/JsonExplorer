/** A usage mistake (unknown option, missing value, wrong argument count): exit code 2 with help. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function suggestion(name, options) {
  const best = Object.keys(options)
    .map((candidate) => ({ candidate, score: distance(name, candidate) }))
    .sort((x, y) => x.score - y.score)[0];
  return best && best.score <= 2 ? ` Did you mean --${best.candidate}?` : '';
}

function convert(name, type, raw) {
  if (type !== 'number') return raw;
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value)) throw new UsageError(`--${name} expects a number, got "${raw}".`);
  return value;
}

/**
 * Parses command-line arguments against a spec:
 * `{ name: { type: 'boolean' | 'string' | 'number', alias?: 'o', multiple?: true } }`.
 * Supports `--name value`, `--name=value`, `-o value`, `--no-flag` for booleans, `-` for stdin
 * and `--` to end options. Unknown options are errors, with a suggestion for typos.
 */
export function parseArgs(argv, options) {
  const values = {};
  const positionals = [];
  // Own names only: "--constructor" must not find Object.prototype.constructor.
  const known = new Map(Object.entries(options));
  const aliases = new Map(
    Object.entries(options)
      .filter(([, spec]) => spec.alias)
      .map(([name, spec]) => [spec.alias, name])
  );

  const assign = (name, value) => {
    const spec = known.get(name);
    const converted = convert(name, spec.type, value);
    if (spec.multiple) values[name] = [...(values[name] ?? []), converted];
    else values[name] = converted;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    let name;
    let inline;
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
      inline = equals === -1 ? undefined : arg.slice(equals + 1);
      if (!known.has(name) && name.startsWith('no-') && known.get(name.slice(3))?.type === 'boolean' && inline === undefined) {
        values[name.slice(3)] = false;
        continue;
      }
      if (!known.has(name)) throw new UsageError(`Unknown option --${name}.${suggestion(name, options)}`);
    } else if (arg.length > 1 && arg.startsWith('-') && !/^-\d/.test(arg)) {
      name = aliases.get(arg.slice(1));
      if (!name) throw new UsageError(`Unknown option ${arg}.`);
    } else {
      positionals.push(arg);
      continue;
    }
    const spec = known.get(name);
    if (spec.type === 'boolean') {
      if (inline !== undefined) throw new UsageError(`--${name} does not take a value.`);
      values[name] = true;
      continue;
    }
    if (inline !== undefined) {
      assign(name, inline);
      continue;
    }
    if (index + 1 >= argv.length) throw new UsageError(`--${name} needs a value.`);
    index += 1;
    assign(name, argv[index]);
  }
  return { values, positionals };
}
