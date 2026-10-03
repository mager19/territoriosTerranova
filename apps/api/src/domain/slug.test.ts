import { describe, expect, it } from 'vitest';

import { SLUG_FALLBACK, SLUG_MAX_LENGTH, territorySlugBase } from './slug.js';

describe('territorySlugBase', () => {
  it.each([
    ['Nv-01', 'nv-01'],
    ['Barrio Niquía 3', 'barrio-niquia-3'],
    ['  Paris  ', 'paris'],
    ['Pérez Ñuñoa Álvarez Güemes', 'perez-nunoa-alvarez-guemes'],
    ['CAÑAVERAL – ÉXITO', 'canaveral-exito'],
    ['Calle 50 # 45-12 (Sur)', 'calle-50-45-12-sur'],
    ['a__b..c', 'a-b-c'],
    ['--Zona--', 'zona'],
    ['N°7', 'n-7']
  ])('normalizes %j to %j', (name, expected) => {
    expect(territorySlugBase(name)).toBe(expected);
  });

  it.each(['', '   ', '###', '¿?¡!', '—'])('falls back to %j → "territorio" when nothing URL-safe is left', (name) => {
    expect(territorySlugBase(name)).toBe(SLUG_FALLBACK);
  });

  it('caps the slug length and never ends a truncated slug with a hyphen', () => {
    const slug = territorySlugBase(`${'a'.repeat(SLUG_MAX_LENGTH - 1)} bcd`);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug).toBe('a'.repeat(SLUG_MAX_LENGTH - 1));
  });

  it('only ever produces [a-z0-9-] with no leading, trailing, or doubled hyphen', () => {
    for (const name of ['Ünïcödé Ståd', 'x / y \\ z', 'Tab\tand\nnewline', 'emoji 🙂 zone']) {
      const slug = territorySlugBase(name);
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
