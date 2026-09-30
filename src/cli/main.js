import { parseArgs, UsageError } from './args';
import { convert } from './commands/convert';
import { diff } from './commands/diff';
import { explore } from './commands/explore';
import { format, minify, sortKeys } from './commands/format';
import { hook } from './commands/hook';
import { outline } from './commands/outline';
import { query } from './commands/query';
import { repair } from './commands/repair';
import { validate } from './commands/validate';
import { DocumentError } from './documents';
import { InputError } from './io';
import { JsonPathError } from './jsonpath';
import { VERSION } from './version';

export const COMMANDS = [explore, outline, query, diff, validate, repair, format, minify, sortKeys, convert, hook];
const BY_NAME = new Map(COMMANDS.map((command) => [command.name, command]));
const ALIASES = { fmt: 'format', sort: 'sort-keys', view: 'explore', get: 'query' };

function generalHelp() {
  const visible = COMMANDS.filter((command) => !command.hidden);
  const width = Math.max(...visible.map((command) => command.name.length));
  return [
    `JSON Explorer ${VERSION}: explore, query, compare, validate, repair, format and convert JSON.`,
    'Everything runs locally: nothing is uploaded, and no command uses the network.',
    '',
    'Usage: json-explorer <command> [options]      (files: JSON, JSONC or JSON Lines; "-" reads stdin)',
    '',
    'Commands:',
    ...visible.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`),
    '',
    'Run "json-explorer <command> --help" for its options and examples.',
    'Exit status: 0 success · 1 check failed (invalid, different, would change) · 2 error.',
  ].join('\n');
}

function commandHelp(command) {
  const entries = Object.entries(command.options).map(([name, spec]) => {
    const flag = `${spec.alias ? `-${spec.alias}, ` : ''}--${name}${spec.type === 'boolean' ? '' : ' <value>'}`;
    return [flag, spec.description];
  });
  const width = Math.max(0, ...entries.map(([flag]) => flag.length));
  return [
    `Usage: json-explorer ${command.usage}`,
    '',
    ...command.description,
    ...(entries.length ? ['', 'Options:', ...entries.map(([flag, text]) => `  ${flag.padEnd(width)}  ${text}`)] : []),
    ...(command.examples.length ? ['', 'Examples:', ...command.examples.map((example) => `  json-explorer ${example}`)] : []),
  ].join('\n');
}

/**
 * Runs the CLI. `io` supplies { stdout, stderr, stdin, cwd, env, assetsDir, scriptPath }, where
 * stdout/stderr are functions taking a string. Resolves to the exit status.
 */
export async function main(argv, io) {
  const ctx = {
    ...io,
    write: (text) => io.stdout(text),
    out: (text) => io.stdout(`${text}\n`),
    err: (text) => io.stderr(`${text}\n`),
  };
  const [name, ...rest] = argv;
  if (name === undefined || name === '--help' || name === '-h') {
    ctx.out(generalHelp());
    return 0;
  }
  if (name === '--version' || name === '-v') {
    ctx.out(VERSION);
    return 0;
  }
  if (name === 'help') {
    const topic = BY_NAME.get(ALIASES[rest[0]] ?? rest[0]);
    ctx.out(topic ? commandHelp(topic) : generalHelp());
    return 0;
  }
  const command = BY_NAME.get(ALIASES[name] ?? name);
  try {
    if (!command) {
      throw new UsageError(`Unknown command "${name}". Commands: ${COMMANDS.filter((item) => !item.hidden).map((item) => item.name).join(', ')}.`);
    }
    const { values, positionals } = parseArgs(rest, { ...command.options, help: { type: 'boolean', alias: 'h' } });
    if (values.help) {
      ctx.out(commandHelp(command));
      return 0;
    }
    return await command.run({ values, positionals }, ctx);
  } catch (error) {
    if (error instanceof UsageError) {
      ctx.err(`json-explorer: ${error.message}`);
      ctx.err(`Run "json-explorer ${command ? `${command.name} ` : ''}--help" for usage.`);
      return 2;
    }
    if (error instanceof InputError || error instanceof DocumentError || error instanceof JsonPathError) {
      ctx.err(`json-explorer: ${error.message}`);
      return 2;
    }
    if (error instanceof RangeError) {
      ctx.err(
        /call stack/i.test(error.message)
          ? 'json-explorer: the document is nested too deeply for this operation.'
          : `json-explorer: the data is too large for this operation (${error.message}).`
      );
      return 2;
    }
    ctx.err(`json-explorer: unexpected error: ${error.stack ?? error}`);
    return 2;
  }
}
