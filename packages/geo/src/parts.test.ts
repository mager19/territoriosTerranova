import { describe, expect, it } from 'vitest';

import { combineParts, largestPart, polygonParts, ringArea } from './parts.js';
import type { MultiPolygon, Polygon } from './types.js';

const square = (west: number, south: number, size: number): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [west + size, south],
      [west + size, south + size],
      [west, south + size],
      [west, south]
    ]
  ]
});

const SMALL = square(-75.56, 6.33, 0.001);
const LARGE = square(-75.55, 6.33, 0.003);

describe('polygonParts', () => {
  it('returns a Polygon as its single part', () => {
    expect(polygonParts(SMALL)).toEqual([SMALL]);
  });

  it('splits a MultiPolygon into one Polygon per part, in order', () => {
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [SMALL.coordinates, LARGE.coordinates] };
    expect(polygonParts(multi)).toEqual([SMALL, LARGE]);
  });
});

describe('combineParts', () => {
  it('returns a Polygon for one part (the API contract for single-part territories)', () => {
    expect(combineParts([SMALL])).toEqual(SMALL);
  });

  it('returns a MultiPolygon for two or more parts', () => {
    expect(combineParts([SMALL, LARGE])).toEqual({
      type: 'MultiPolygon',
      coordinates: [SMALL.coordinates, LARGE.coordinates]
    });
  });

  it('refuses zero parts rather than inventing a geometry', () => {
    expect(() => combineParts([])).toThrow(/at least one part/);
  });
});

describe('largestPart', () => {
  it('picks the part with the largest planar area, regardless of order', () => {
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [SMALL.coordinates, LARGE.coordinates] };
    expect(largestPart(multi)).toEqual(LARGE);
    const reversed: MultiPolygon = { type: 'MultiPolygon', coordinates: [LARGE.coordinates, SMALL.coordinates] };
    expect(largestPart(reversed)).toEqual(LARGE);
  });

  it('subtracts holes when measuring a part', () => {
    const outer = square(-75.56, 6.33, 0.004).coordinates[0]!;
    const hole = square(-75.5595, 6.3305, 0.003).coordinates[0]!;
    const holed: Polygon = { type: 'Polygon', coordinates: [outer, hole] };
    const solid = square(-75.54, 6.33, 0.003);
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [holed.coordinates, solid.coordinates] };
    expect(largestPart(multi)).toEqual(solid);
  });

  it('returns a Polygon unchanged', () => {
    expect(largestPart(SMALL)).toEqual(SMALL);
  });
});

describe('ringArea', () => {
  it('is orientation-independent', () => {
    const ring = SMALL.coordinates[0]!;
    expect(ringArea(ring)).toBeCloseTo(1e-6, 12);
    expect(ringArea([...ring].reverse())).toBeCloseTo(1e-6, 12);
  });
});
