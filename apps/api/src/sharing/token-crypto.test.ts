import { describe, expect, it } from 'vitest';

import { generateShareToken, hashShareToken, hashesEqual } from './token-crypto.js';

describe('generateShareToken', () => {
  it('produces a URL-safe, unpadded base64url string', () => {
    const token = generateShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain('=');
    expect(token).not.toContain('+');
    expect(token).not.toContain('/');
  });

  it('carries 256 bits of entropy — 32 raw bytes, base64url-encoded to 43 characters', () => {
    const token = generateShareToken();
    // 32 bytes -> ceil(32*8/6) = 43 base64 characters, no padding.
    expect(token).toHaveLength(43);
  });

  it('is not sequential or predictable: 1000 tokens are all unique', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateShareToken()));
    expect(tokens.size).toBe(1000);
  });

  it('is never derived from any identifier — two calls share no structure beyond format', () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).not.toBe(b);
    // No shared prefix of meaningful length (a real CSPRNG output has no
    // structural relationship between independent draws).
    let sharedPrefix = 0;
    while (sharedPrefix < a.length && a[sharedPrefix] === b[sharedPrefix]) sharedPrefix += 1;
    expect(sharedPrefix).toBeLessThan(8);
  });
});

describe('hashShareToken', () => {
  it('is deterministic: the same input always hashes the same', () => {
    const token = generateShareToken();
    expect(hashShareToken(token)).toBe(hashShareToken(token));
  });

  it('produces a hex-encoded SHA-256 digest (64 hex characters)', () => {
    const hash = hashShareToken(generateShareToken());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never contains or resembles the plaintext token it was derived from', () => {
    const token = generateShareToken();
    const hash = hashShareToken(token);
    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
  });

  it('different tokens hash to different values', () => {
    const a = hashShareToken(generateShareToken());
    const b = hashShareToken(generateShareToken());
    expect(a).not.toBe(b);
  });
});

describe('hashesEqual', () => {
  it('returns true for identical hashes', () => {
    const hash = hashShareToken(generateShareToken());
    expect(hashesEqual(hash, hash)).toBe(true);
  });

  it('returns false for different hashes', () => {
    expect(hashesEqual(hashShareToken('a'), hashShareToken('b'))).toBe(false);
  });

  it('returns false, not throws, for different-length inputs', () => {
    expect(hashesEqual('short', 'a-much-longer-string-than-short')).toBe(false);
  });
});
