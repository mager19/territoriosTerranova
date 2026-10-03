import { describe, expect, it } from 'vitest';

import { parseShareLink, publicTerritoryPath } from './share-link.js';

describe('parseShareLink', () => {
  it('reads a fixed /t/<slug> URL', () => {
    expect(parseShareLink('/t/nv-01', '')).toEqual({ kind: 'slug', slug: 'nv-01' });
  });

  it('tolerates one trailing slash', () => {
    expect(parseShareLink('/t/barrio-niquia-3/', '')).toEqual({ kind: 'slug', slug: 'barrio-niquia-3' });
  });

  it('prefers the path over a fragment when both are present', () => {
    expect(parseShareLink('/t/nv-01', '#tok-abc')).toEqual({ kind: 'slug', slug: 'nv-01' });
  });

  it.each(['/t/', '/t/NV-01', '/t/nv_01', '/t/nv%2001', `/t/${'a'.repeat(81)}`, '/t/nv-01/extra', '/t/..'])(
    'rejects %j — not a URL-safe slug — without ever falling back to a token',
    (pathname) => {
      expect(parseShareLink(pathname, '#tok-abc')).toBeNull();
    }
  );

  it('keeps supporting legacy #token links at the root', () => {
    expect(parseShareLink('/', '#tok-abc')).toEqual({ kind: 'token', token: 'tok-abc' });
  });

  it('returns null when the URL carries neither a slug nor a token', () => {
    expect(parseShareLink('/', '')).toBeNull();
    expect(parseShareLink('/', '#   ')).toBeNull();
  });
});

describe('publicTerritoryPath', () => {
  it('maps a slug to the fixed public endpoint', () => {
    expect(publicTerritoryPath({ kind: 'slug', slug: 'nv-01' })).toBe('/public/t/nv-01');
  });

  it('maps a legacy token to the token endpoint, URL-encoded', () => {
    expect(publicTerritoryPath({ kind: 'token', token: 'a/b c' })).toBe('/public/territories/a%2Fb%20c');
  });
});
