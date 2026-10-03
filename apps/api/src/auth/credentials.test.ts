import { describe, expect, it } from 'vitest';

import { verifyAdminCredentials } from './credentials.js';

const ACCOUNTS = [
  { email: 'ana@example.org', password: 'correct horse battery' },
  { email: 'beto@example.org', password: 'staple-gun-42-orchid' }
];

describe('verifyAdminCredentials', () => {
  it('returns the canonical account email for a correct pair, matching the email case-insensitively', () => {
    expect(verifyAdminCredentials(ACCOUNTS, ' Ana@Example.ORG ', 'correct horse battery')).toBe('ana@example.org');
    expect(verifyAdminCredentials(ACCOUNTS, 'beto@example.org', 'staple-gun-42-orchid')).toBe('beto@example.org');
  });

  it('rejects a wrong password, a password of another account, and an unknown email', () => {
    expect(verifyAdminCredentials(ACCOUNTS, 'ana@example.org', 'correct horse batter')).toBeNull();
    expect(verifyAdminCredentials(ACCOUNTS, 'ana@example.org', 'staple-gun-42-orchid')).toBeNull();
    expect(verifyAdminCredentials(ACCOUNTS, 'eve@example.org', 'correct horse battery')).toBeNull();
  });

  it('compares the password exactly: case and surrounding whitespace matter', () => {
    expect(verifyAdminCredentials(ACCOUNTS, 'ana@example.org', 'Correct horse battery')).toBeNull();
    expect(verifyAdminCredentials(ACCOUNTS, 'ana@example.org', ' correct horse battery')).toBeNull();
  });

  it('rejects non-string and empty input', () => {
    expect(verifyAdminCredentials(ACCOUNTS, undefined, 'correct horse battery')).toBeNull();
    expect(verifyAdminCredentials(ACCOUNTS, 'ana@example.org', 42)).toBeNull();
    expect(verifyAdminCredentials(ACCOUNTS, '', '')).toBeNull();
  });

  it('rejects everything when no account is configured', () => {
    expect(verifyAdminCredentials([], 'ana@example.org', 'correct horse battery')).toBeNull();
  });
});
