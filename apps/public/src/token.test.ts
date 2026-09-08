import { describe, expect, it } from 'vitest';

import { extractToken } from './token.js';

describe('extractToken', () => {
  it('strips the leading # from a hash containing a token', () => {
    expect(extractToken('#abc123')).toBe('abc123');
  });

  it('returns null for an empty hash (no token in the URL)', () => {
    expect(extractToken('')).toBeNull();
  });

  it('returns null for a hash that is only the # character', () => {
    expect(extractToken('#')).toBeNull();
  });

  it('returns null for a whitespace-only fragment', () => {
    expect(extractToken('#   ')).toBeNull();
  });

  it('accepts a bare token without a leading #', () => {
    expect(extractToken('abc123')).toBe('abc123');
  });
});
