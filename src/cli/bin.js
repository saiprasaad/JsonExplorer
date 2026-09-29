import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './main';

// Entry point of the bundled script (scripts/json-explorer.mjs in the skill); assets/ is its sibling.
const scriptPath = fileURLToPath(import.meta.url);

process.stdout.on('error', (error) => {
  // Output piped into a command that stopped reading (e.g. `| head`): not an error.
  if (error.code === 'EPIPE') process.exit(process.exitCode ?? 0);
  throw error;
});

main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  stdin: process.stdin,
  cwd: process.cwd(),
  env: process.env,
  stdoutIsTTY: Boolean(process.stdout.isTTY),
  assetsDir: path.join(path.dirname(scriptPath), '..', 'assets'),
  scriptPath,
}).then((code) => {
  process.exitCode = code;
});
