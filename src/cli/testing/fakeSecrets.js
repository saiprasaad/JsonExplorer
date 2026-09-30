/*
 * Fake credentials for the tests of secret masking. Each one is assembled at run time from pieces,
 * so no source file contains anything that secret scanners (GitGuardian, GitHub secret scanning)
 * report. None of them is, or ever was, a real credential: they are spelled from counting digits
 * and letters, and the JWT is signed by nothing.
 */

const glue = (...parts) => parts.join('');
const DIGITS = '0123456789';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const CLASSIC_PASSWORD = glue('hunter', '2'); // the Internet's best-known example password

/** An "sk-…" key (the shape OpenAI and Anthropic keys take) ending in `rest`. */
export const skKey = (rest) => glue('sk', '-', rest);

export const FAKE = {
  password: CLASSIC_PASSWORD,
  awsAccessKeyId: glue('AKIA', 'IOSFODNN7EXAMPLE'), // the example key id from AWS's documentation
  githubToken: glue('ghp', '_', DIGITS, LETTERS, 'AB'),
  githubFineGrainedToken: glue('github', '_pat_', '11ABCDEFG', DIGITS, '_', LETTERS.slice(0, 12)),
  gitlabToken: glue('glpat', '-', LETTERS.slice(0, 10), DIGITS),
  slackToken: glue('xoxb', '-', '1234567890', '-', LETTERS.slice(0, 10)),
  slackWebhook: glue('https://hooks.', 'slack.com/services/', 'T0000/B0000/', 'X'.repeat(16)),
  stripeSecretKey: glue('sk', '_live_', DIGITS, LETTERS.slice(0, 10)),
  stripeRestrictedKey: glue('rk', '_test_', DIGITS, LETTERS.slice(0, 10)),
  googleApiKey: glue('AIza', 'SyA-', DIGITS, LETTERS.slice(0, 21)),
  googleOAuthSecret: glue('GOCSPX', '-', DIGITS, LETTERS.slice(0, 14)),
  openAiProjectKey: skKey(glue('proj-', DIGITS, LETTERS.slice(0, 12))),
  npmToken: glue('npm', '_', DIGITS, LETTERS),
  huggingFaceToken: glue('hf', '_', DIGITS, LETTERS.slice(0, 22)),
  sendGridKey: glue('SG', '.', DIGITS, LETTERS.slice(0, 10), '.', DIGITS, LETTERS.slice(0, 10)),
  digitalOceanToken: glue('dop', '_v1_', 'a'.repeat(64)),
  jwt: glue(base64url({ alg: 'HS256' }), '.', base64url({ sub: '1234567890' }), '.', 'signed_by_nothing_', DIGITS),
  privateKey: glue('-----BEGIN RSA ', 'PRIVATE KEY', '-----\nMIIE...'),
  bearerToken: glue('Bearer ', LETTERS, '.0123'),
  basicAuth: glue('Basic ', Buffer.from('user:password').toString('base64')),
  postgresUrl: glue('postgres://admin', ':', CLASSIC_PASSWORD, '@db.internal:5432/app'),
  urlWithPassword: glue('https://u', ':', 'p4ss', '@host/x'),
  sqlServerConnection: glue('Server=db;Database=app;User Id=sa;', 'Pass', 'word=SuperSecret123;'),
  azureStorageConnection: glue('DefaultEndpointsProtocol=https;AccountName=x;', 'Account', 'Key=abc123def456==;'),
  urlWithToken: glue('https://api.example.com/v1/items?', 'access', '_token=abcdefgh12345678'),
  azureSasUrl: glue('https://store.blob.core.windows.net/c/f?sv=2020&', 'sig', '=abcdefghijklmnop%3D'),
  // The card networks' published test numbers: they pass the Luhn check but pay for nothing.
  visaCard: glue('4111', '1111', '1111', '1111'),
  mastercard: glue('5555', '5555', '5555', '4444'),
  amexCard: glue('3782', '822463', '10005'),
};
