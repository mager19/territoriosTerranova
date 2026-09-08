/**
 * Share-token generation and hashing (A4 brief). The token itself is a
 * scoped public bearer secret for one assignment — never an administrator
 * principal, never derived from any identifier, never sequential.
 *
 * 256 bits of CSPRNG entropy, base64url-encoded (unpadded — URL-safe with
 * no encoding surprises). The database stores only `hashToken(token)`;
 * the plaintext is returned to the caller exactly once, at creation, and
 * never persisted or logged anywhere.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32; // 256 bits

export function generateShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two hash strings. Not the primary defense
 * against timing leaks here (the real one is validateShareToken always
 * doing the same DB work regardless of outcome — see sharing/tokens.ts) —
 * this just avoids ALSO introducing a cheap, needless timing signal via a
 * naive `===` on secret-derived strings, on the rare path where two hashes
 * are compared directly in application code instead of in a SQL WHERE.
 */
export function hashesEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
