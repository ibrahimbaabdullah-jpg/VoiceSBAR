import { pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CLIENT_KDF_ITERATIONS, CLIENT_KDF_SALT_PREFIX, PASSWORD_KEY_PATTERN } from '../../shared/rules';
import { derivePasswordKey } from '../../src/lib/passwordKey';

describe('derivePasswordKey', () => {
  it('matches PBKDF2-SHA256 with the documented parameters', async () => {
    const key = await derivePasswordKey('Sara', 'correct horse battery');
    const expected = pbkdf2Sync(
      'correct horse battery',
      `${CLIENT_KDF_SALT_PREFIX}sara`,
      CLIENT_KDF_ITERATIONS,
      32,
      'sha256',
    ).toString('base64url');
    expect(key).toBe(expected);
    expect(key).toMatch(PASSWORD_KEY_PATTERN);
  });

  it('treats usernames case-insensitively but salts per user', async () => {
    const a = await derivePasswordKey(' SARA ', 'same password');
    const b = await derivePasswordKey('sara', 'same password');
    const c = await derivePasswordKey('omar', 'same password');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
