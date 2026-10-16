import { CLIENT_KDF_ITERATIONS, CLIENT_KDF_SALT_PREFIX } from '../../shared/rules';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Stretches the password in the browser with PBKDF2-SHA256 (600k iterations, salted with the
 * username) so the server never receives the password itself. See shared/rules.ts.
 */
export async function derivePasswordKey(username: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw',
    enc.encode(password.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: enc.encode(CLIENT_KDF_SALT_PREFIX + username.trim().toLowerCase()),
      iterations: CLIENT_KDF_ITERATIONS,
    },
    material,
    256,
  );
  return toBase64Url(new Uint8Array(bits));
}
