/** @jest-environment node */
import { RawNumber } from '../utils/json';
import { isSensitiveKey, isSensitiveMember, isSensitivePath, looksLikeSecret, maskValues, REDACTED, redactAt, redactPathKeys, redactText, redactValue } from './redact';
import { FAKE, skKey } from './testing/fakeSecrets';

describe('isSensitiveKey', () => {
  it.each([
    'password',
    'passwords',
    'Password',
    'user_password',
    'db-passwd',
    'pwd',
    'pass',
    'passphrase',
    'clientSecret',
    'secrets',
    'credentials',
    'Cookie',
    'Authorization',
    'dsn',
    'ssn',
    'cardCvv',
    'cvc',
    'pin',
    'otp',
    'auth',
    'Auth',
    'accessToken',
    'access_token',
    'refresh-token',
    'tokens',
    'refreshTokens',
    'apiKey',
    'apiKeys',
    'X-API-KEY',
    'awsAccessKey',
    'privateKey',
    'privateKeys',
    'secret_key',
    'sessionId',
    'sessionIds',
    'bearer',
    'signingKey',
    'encryption_key',
    'masterKey',
    'webhook_url',
    'connectionString',
    'session',
    'userSession',
    'sid',
    'SID',
    'iban',
    'customer_iban',
    'creditCard',
    'credit_card_number',
    'cardNumber',
    'cc_number',
    'debitCard',
  ])('flags %s', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(['name', 'email', 'author', 'authority', 'tokens_used', 'passport', 'passenger', 'pinned', 'spin', 'keyboard', 'id', '', 'session_count', 'sessionDuration', 'possession', 'sidebar', 'card_type', 'card_last4', 'cardholder_name'])('does not flag %s', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  it('ignores array indexes and missing keys', () => {
    expect(isSensitiveKey(0)).toBe(false);
    expect(isSensitiveKey(undefined)).toBe(false);
  });
});

describe('looksLikeSecret', () => {
  it.each([
    FAKE.awsAccessKeyId,
    FAKE.githubToken,
    FAKE.githubFineGrainedToken,
    FAKE.gitlabToken,
    FAKE.slackToken,
    FAKE.slackWebhook,
    FAKE.stripeSecretKey,
    FAKE.stripeRestrictedKey,
    FAKE.googleApiKey,
    FAKE.googleOAuthSecret,
    FAKE.openAiProjectKey,
    FAKE.npmToken,
    FAKE.huggingFaceToken,
    FAKE.sendGridKey,
    FAKE.digitalOceanToken,
    FAKE.jwt,
    FAKE.privateKey,
    FAKE.bearerToken,
    FAKE.basicAuth,
    FAKE.postgresUrl,
    FAKE.sqlServerConnection,
    FAKE.azureStorageConnection,
    FAKE.urlWithToken,
    FAKE.azureSasUrl,
    FAKE.visaCard,
    FAKE.mastercard,
    FAKE.amexCard,
    FAKE.visaCard.replace(/(\d{4})(?=\d)/g, '$1 '),
    FAKE.visaCard.replace(/(\d{4})(?=\d)/g, '$1-'),
    ` ${FAKE.mastercard} `,
    // The shortest secret-looking string there is.
    ['pwd', 'abc'].join('='),
  ])('recognizes %s', (value) => {
    expect(looksLikeSecret(value)).toBe(true);
  });

  it.each([
    'hello',
    'https://example.com/path',
    'https://example.com/?key=short',
    'mailto:someone@example.com',
    'sk-short',
    'Bearer x',
    'Basic auth is disabled',
    ['pwd', 'ab'].join('='),
    // Card-length numbers without a valid check digit, without a card network's prefix, or with other text around them.
    `${FAKE.visaCard.slice(0, -1)}2`,
    '1234567812345670',
    `order ${FAKE.visaCard}`,
    '4111 1111  1111 1111',
    '411111111111',
  ])('leaves %s alone', (value) => {
    expect(looksLikeSecret(value)).toBe(false);
  });

  it('only considers strings', () => {
    expect(looksLikeSecret(42)).toBe(false);
    expect(looksLikeSecret(null)).toBe(false);
  });

  it('takes linear time on inputs made to backtrack', () => {
    const inputs = [`a@${'a.'.repeat(100000)} x`, `${'eyJ-'.repeat(50000)}!`, `${'a://'.repeat(50000)}`, `Bearer${' '.repeat(100000)}!`, `-----BEGIN ${'A'.repeat(100000)}`];
    const started = Date.now();
    inputs.forEach((input) => expect(looksLikeSecret(input)).toBe(false));
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('redactValue', () => {
  it('masks values under sensitive keys, all the way down, and counts them', () => {
    const counter = { count: 0 };
    const input = {
      user: 'ada',
      password: FAKE.password,
      auth: { user: 'x', token: 'y', nested: [1, { deep: 'z', flag: true }] },
      note: 'call me',
      key: skKey('live-0123456789abcdefghijk'),
      empty: null,
      big: new RawNumber('12345678901234567890'),
    };
    expect(redactValue(input, undefined, counter)).toEqual({
      user: 'ada',
      password: REDACTED,
      auth: { user: REDACTED, token: REDACTED, nested: [REDACTED, { deep: REDACTED, flag: true }] },
      note: 'call me',
      key: REDACTED,
      empty: null,
      big: input.big,
    });
    expect(counter.count).toBe(6);
  });

  it('masks numbers and exact numbers under sensitive keys, but never null or booleans', () => {
    const counter = { count: 0 };
    expect(redactValue({ pin: 1, cvv: new RawNumber('0123'), secret: null, otp: false }, undefined, counter)).toEqual({ pin: REDACTED, cvv: REDACTED, secret: null, otp: false });
    expect(counter.count).toBe(2);
  });

  it('uses the key a value sits under, and what is above it', () => {
    const counter = { count: 0 };
    expect(redactValue('abc', 'apiKey', counter)).toBe(REDACTED);
    expect(redactValue(['a', 'b'], 'names', counter)).toEqual(['a', 'b']);
    expect(redactValue(['a', 'b'], 'passwords', counter)).toEqual([REDACTED, REDACTED]);
    expect(redactValue('plain', 'value', counter, true)).toBe(REDACTED);
    expect(counter.count).toBe(4);
  });

  it('masks the values of settings whose name is sensitive', () => {
    const counter = { count: 0 };
    const env = [
      { name: 'DB_PASSWORD', value: FAKE.password },
      { name: 'HOME', value: '/home/app' },
      { Name: 'Authorization', Value: 'Basic dXNlcg' },
      { ParameterKey: 'DbPassword', ParameterValue: `${FAKE.password}-cfn` },
      { key: 'api_key', data: { nested: 'x' } },
    ];
    expect(redactValue(env, 'env', counter)).toEqual([
      { name: 'DB_PASSWORD', value: REDACTED },
      { name: 'HOME', value: '/home/app' },
      { Name: 'Authorization', Value: REDACTED },
      { ParameterKey: 'DbPassword', ParameterValue: REDACTED },
      { key: 'api_key', data: { nested: REDACTED } },
    ]);
    expect(counter.count).toBe(4);
  });

  it('can put something other than [REDACTED] in place of a secret', () => {
    const counter = { count: 0 };
    expect(redactValue({ password: FAKE.password, list: [FAKE.githubToken, 'ok'], n: 1 }, undefined, counter, false, null)).toEqual({ password: null, list: [null, 'ok'], n: 1 });
    expect(counter.count).toBe(2);
  });

  it('copies "__proto__" members as plain data', () => {
    const input = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
    const copy = redactValue(input, undefined, { count: 0 });
    expect(Object.keys(copy)).toEqual(['__proto__', 'a']);
    expect(copy.polluted).toBeUndefined();
    expect({}.polluted).toBeUndefined();
  });
});

describe('sensitive paths', () => {
  const root = {
    credentials: { value: FAKE.password },
    passwords: [`${FAKE.password}-1`, `${FAKE.password}-2`],
    env: [
      { name: 'DB_PASSWORD', value: FAKE.password },
      { name: 'HOME', value: '/home' },
    ],
    public: { value: 1 },
  };

  it.each([
    [['credentials', 'value'], true],
    [['credentials'], true],
    [['passwords', 0], true],
    [['env', 0, 'value'], true],
    [['env', 1, 'value'], false],
    [['env', 0, 'name'], false],
    [['public', 'value'], false],
    [['missing', 'deeper'], false],
    [[], false],
  ])('%j is sensitive: %s', (pathArray, expected) => {
    expect(isSensitivePath(root, pathArray)).toBe(expected);
  });

  it('masks a value by where it was found', () => {
    const counter = { count: 0 };
    expect(redactAt(root, ['credentials', 'value'], FAKE.password, counter)).toBe(REDACTED);
    expect(redactAt(root, ['passwords', 1], root.passwords[1], counter)).toBe(REDACTED);
    expect(redactAt(root, ['public'], { value: 1 }, counter)).toEqual({ value: 1 });
    expect(counter.count).toBe(2);
  });

  it('tells which members hold secrets', () => {
    expect(isSensitiveMember({ name: 'API_TOKEN', value: 'x' }, 'value')).toBe(true);
    expect(isSensitiveMember({ name: 'API_TOKEN', value: 'x' }, 'name')).toBe(false);
    expect(isSensitiveMember({ token: 'x' }, 'token')).toBe(true);
    expect(isSensitiveMember({ name: 42, value: 'x' }, 'value')).toBe(false);
  });

  it('masks keys that look like secrets', () => {
    const counter = { count: 0 };
    expect(redactPathKeys(['tokens', FAKE.githubToken, 0], counter)).toEqual(['tokens', REDACTED, 0]);
    expect(counter.count).toBe(1);
  });
});

describe('redactText', () => {
  it('masks members with sensitive names in raw JSON text', () => {
    expect(redactText(`{"password": "${FAKE.password}", "user": "ada", "pin": 1234, "token":true}`)).toBe(`{"password": "${REDACTED}", "user": "ada", "pin": ${REDACTED}, "token":true}`);
  });

  it('masks whole strings that contain something secret-looking, and keys that are secrets', () => {
    expect(redactText(`"url": "${FAKE.urlWithPassword}", "k": "${FAKE.awsAccessKeyId} and more", "${FAKE.githubToken}": 1`)).toBe(
      `"url": "${REDACTED}", "k": "${REDACTED}", "${REDACTED}": 1`
    );
  });

  it('masks members in almost-JSON: single-quoted or bare keys, Python literals', () => {
    expect(redactText(`{'password': '${FAKE.password}', user: 'ada', secret_key: True, token: 42, ok: False, none: None}`)).toBe(
      `{'password': '${REDACTED}', user: 'ada', secret_key: True, token: ${REDACTED}, ok: False, none: None}`
    );
  });

  it('follows nesting across lines', () => {
    const text = ['{', '  "credentials": {', '    "user": "admin",', `    "pass": "${FAKE.password}"`, '  },', '  "passwords": ["a", "b",],', '  "password":', '    "next-line",', '  "ok": "shown"', '}'].join('\n');
    expect(redactText(text)).toBe(
      ['{', '  "credentials": {', `    "user": "${REDACTED}",`, `    "pass": "${REDACTED}"`, '  },', `  "passwords": ["${REDACTED}", "${REDACTED}",],`, '  "password":', `    "${REDACTED}",`, '  "ok": "shown"', '}'].join('\n')
    );
  });

  it('masks the values of settings whose name is sensitive', () => {
    expect(redactText(`[{"name": "DB_PASSWORD", "value": "${FAKE.password}"}, {"name": "HOME", "value": "/home"}, {"value": {"a": "b"}, "key": "token"}]`)).toBe(
      `[{"name": "DB_PASSWORD", "value": "${REDACTED}"}, {"name": "HOME", "value": "/home"}, {"value": {"a": "${REDACTED}"}, "key": "token"}]`
    );
  });

  it('copes with broken text: unterminated strings, stray and missing brackets, comments', () => {
    expect(redactText('{"password": "abc')).toBe(`{"password": "${REDACTED}`);
    expect(redactText(']} {"secret": [1, {"a": 2')).toBe(`]} {"secret": [${REDACTED}, {"a": ${REDACTED}`);
    expect(redactText(`{"a": 1, // was ${FAKE.githubToken}\n "b": 2 /* ok */}`)).toBe(`{"a": 1, // was ${REDACTED}\n "b": 2 /* ok */}`);
    expect(redactText('{"password": , "b": "c"}')).toBe('{"password": , "b": "c"}');
  });

  it('leaves literals alone wherever they are', () => {
    expect(redactText('[true, null, {"password": false}]')).toBe('[true, null, {"password": false}]');
  });

  it('masks member names it cannot decode by their raw text', () => {
    expect(redactText('{"pass\\qword": "x"}')).toBe(`{"pass\\qword": "${REDACTED}"}`);
  });

  it('takes linear time on long lines', () => {
    const started = Date.now();
    expect(redactText(`{"a": "${'x'.repeat(200000)}`)).toHaveLength(200007);
    expect(redactText('a'.repeat(200000))).toHaveLength(200000);
    expect(redactText(`'${"\\'".repeat(100000)}`)).toHaveLength(200001);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('maskValues', () => {
  it('hides every value but keeps keys, punctuation and literals', () => {
    expect(maskValues(`  "password": "${FAKE.password}", "n": -12.5e3, "ok": true, "x": null, bare: word, // note`).text).toBe(
      '  "password": "***", "n": ***, "ok": true, "x": null, bare: ***, // ***'
    );
    expect(maskValues("{'a': 'b', \"c\": \"unterminated").text).toBe("{'a': '***', \"c\": \"***");
    expect(maskValues('[1, /* two */ 2, /* open').text).toBe('[***, /* *** */ ***, /* ***');
    expect(maskValues(`{"${FAKE.githubToken}": 1}`).text).toBe('{"***": ***}');
    expect(maskValues(`{${FAKE.githubToken}: 1, plain: 2}`).text).toBe('{***: ***, plain: ***}');
  });

  it('moves the caret along with the text', () => {
    const line = '{"a": "a long string value", "b": x}';
    expect(maskValues(line, line.indexOf('x'))).toEqual({ text: '{"a": "***", "b": ***}', caret: 18 });
    // Inside a hidden value, the caret goes to its start; past the end, it keeps its distance.
    expect(maskValues(line, line.indexOf('long')).caret).toBe(6);
    expect(maskValues(line, line.length + 2).caret).toBe(24);
    expect(maskValues(line).caret).toBe(-1);
  });
});
