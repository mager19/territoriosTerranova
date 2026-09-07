import { describe, expect, it } from 'vitest';

import { isPosition } from './index.js';

describe('isPosition', () => {
  it('accepts a finite [longitude, latitude] pair from verified Bello evidence', () => {
    // Sample vertex from docs/map-references.md (AMVA layer 9, outSR=4326).
    expect(isPosition([-75.57307274994052, 6.358147322663799])).toBe(true);
  });

  it('accepts a position with elevation', () => {
    expect(isPosition([-75.57, 6.35, 1200])).toBe(true);
  });

  it('rejects non-finite numbers', () => {
    expect(isPosition([Number.NaN, 6.35])).toBe(false);
    expect(isPosition([Number.POSITIVE_INFINITY, 6.35])).toBe(false);
  });

  it('rejects arrays of wrong length', () => {
    expect(isPosition([])).toBe(false);
    expect(isPosition([6.35])).toBe(false);
    expect(isPosition([-75.57, 6.35, 1200, 1])).toBe(false);
  });

  it('rejects non-numeric components', () => {
    expect(isPosition(['-75.57', '6.35'])).toBe(false);
    expect(isPosition([-75.57, null])).toBe(false);
  });

  it('rejects non-array values', () => {
    expect(isPosition('[-75.57, 6.35]')).toBe(false);
    expect(isPosition({ lon: -75.57, lat: 6.35 })).toBe(false);
    expect(isPosition(null)).toBe(false);
    expect(isPosition(undefined)).toBe(false);
  });
});
