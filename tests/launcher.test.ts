import { describe, expect, test } from 'bun:test';
import { parseArgs, redacted, validateSessionUrl } from '../tools/launcher.mjs';

describe('launcher argument parsing', () => {
  test('accepts all actions and explicit values', () => {
    expect(parseArgs(['session', '--profile', '/tmp/profile', '--port=19000'])).toEqual({
      action: 'session', profileArgument: '/tmp/profile', portArgument: '19000',
    });
  });

  test.each([
    [['--profile'], 'missing profile'],
    [['--port'], 'missing port'],
    [['--port', 'not-a-port'], 'invalid port'],
    [['--port', '1023'], 'port below range'],
    [['--port', '65535'], 'port above range'],
    [['open', 'status'], 'multiple actions'],
    [['--unknown'], 'unknown option'],
    [['--profile', '/tmp/a', '--profile', '/tmp/b'], 'duplicate profile'],
  ])('rejects %s (%s)', (argv) => {
    expect(() => parseArgs(argv as string[])).toThrow();
  });
});

describe('session URL boundary', () => {
  test('normalizes localhost to loopback and preserves the nonce', () => {
    expect(validateSessionUrl('http://localhost:18868/?nonce=abcdef0123456789')).toBe('http://127.0.0.1:18868/?nonce=abcdef0123456789');
  });

  test.each([
    'https://localhost:18868/?nonce=abcdef0123456789',
    'http://example.test:18868/?nonce=abcdef0123456789',
    'http://127.0.0.1:18868/?nonce=short',
    'http://127.0.0.1:18868/?nonce=abcdef0123456789&extra=1',
    'http://127.0.0.1:18868/other?nonce=abcdef0123456789',
  ])('rejects unsafe or malformed URL %s', (url) => expect(() => validateSessionUrl(url)).toThrow());
});

test('redaction removes one-use URLs and bearer material from log text', () => {
  const output = redacted('ready http://localhost:18868/?nonce=abcdef0123456789\nAuthorization: Bearer secret-token\nnormal status');
  expect(output).not.toContain('nonce=');
  expect(output).not.toContain('secret-token');
  expect(output).toContain('normal status');
});
