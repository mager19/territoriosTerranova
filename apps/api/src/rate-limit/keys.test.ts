import { describe, expect, it } from 'vitest';

import { rateLimitKey } from './keys.js';

describe('rateLimitKey', () => {
  it('prefixes the client IP with the bucket name', () => {
    expect(rateLimitKey('admin-login', '203.0.113.7')).toBe('admin-login:203.0.113.7');
  });

  it('keeps two buckets apart for the same client', () => {
    expect(rateLimitKey('admin-login', '203.0.113.7')).not.toBe(rateLimitKey('public-ip', '203.0.113.7'));
  });

  it('collapses an IPv6 address to its /64, like the plugin default key', () => {
    expect(rateLimitKey('public-ip', '2001:db8:1:2:aaaa::1')).toBe(rateLimitKey('public-ip', '2001:db8:1:2:bbbb::2'));
    expect(rateLimitKey('public-ip', '2001:db8:1:2::1')).not.toBe(rateLimitKey('public-ip', '2001:db8:1:3::1'));
  });
});
