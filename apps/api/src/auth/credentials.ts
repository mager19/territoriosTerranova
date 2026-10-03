/**
 * Email + password check against the env-configured admin accounts
 * (config.ts, docs/admin-auth.md).
 *
 * Timing: both sides are reduced to SHA-256 digests before
 * crypto.timingSafeEqual, so neither the length nor the content of a
 * secret leaks through comparison time, and EVERY configured account is
 * compared on every call — an unknown email does exactly the same work as
 * a known one with a wrong password. There is no early return on a match.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import type { AdminAccount } from '../config.js';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** A stand-in so the comparison work happens even with no account configured. */
const PLACEHOLDER_ACCOUNT: AdminAccount = { email: '\u0000no-account', password: '\u0000no-account' };

/** Returns the matched account's canonical (lower-cased) email, or null. */
export function verifyAdminCredentials(
  accounts: readonly AdminAccount[],
  email: unknown,
  password: unknown
): string | null {
  const candidateEmail = digest(typeof email === 'string' ? email.trim().toLowerCase() : '');
  const candidatePassword = digest(typeof password === 'string' ? password : '');
  const wellFormed = typeof email === 'string' && typeof password === 'string' && email.trim() !== '' && password !== '';

  let matched: string | null = null;
  for (const account of accounts.length === 0 ? [PLACEHOLDER_ACCOUNT] : accounts) {
    const emailMatches = timingSafeEqual(candidateEmail, digest(account.email));
    const passwordMatches = timingSafeEqual(candidatePassword, digest(account.password));
    if (emailMatches && passwordMatches && account !== PLACEHOLDER_ACCOUNT) {
      matched = account.email;
    }
  }
  return wellFormed ? matched : null;
}
