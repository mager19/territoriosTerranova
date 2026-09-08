import { describe, expect, it } from 'vitest';

import { validateTerritoryGeometry } from './geometry.js';
import { InvalidGeometryError } from './errors.js';

const VALID_SQUARE = {
  type: 'Polygon',
  coordinates: [
    [
      [-75.574, 6.357],
      [-75.572, 6.357],
      [-75.572, 6.359],
      [-75.574, 6.359],
      [-75.574, 6.357]
    ]
  ]
};

describe('validateTerritoryGeometry', () => {
  it('accepts a well-formed closed WGS84 polygon', () => {
    expect(validateTerritoryGeometry(VALID_SQUARE)).toEqual(VALID_SQUARE);
  });

  it('rejects a non-Polygon geometry type', () => {
    const point = { type: 'Point', coordinates: [-75.57, 6.35] };
    expect(() => validateTerritoryGeometry(point)).toThrow(InvalidGeometryError);
    expect(() => validateTerritoryGeometry(point)).toThrow(/Polygon/);
  });

  it('rejects a MultiPolygon (application territory geometry is single-Polygon only)', () => {
    const multi = { type: 'MultiPolygon', coordinates: [VALID_SQUARE.coordinates] };
    expect(() => validateTerritoryGeometry(multi)).toThrow(InvalidGeometryError);
  });

  it('rejects an open (unclosed) ring', () => {
    const open = {
      type: 'Polygon',
      coordinates: [[[-75.574, 6.357], [-75.572, 6.357], [-75.572, 6.359]]]
    };
    expect(() => validateTerritoryGeometry(open)).toThrow(InvalidGeometryError);
  });

  it('rejects a ring with fewer than 4 positions', () => {
    const tooFew = {
      type: 'Polygon',
      coordinates: [[[-75.574, 6.357], [-75.572, 6.357], [-75.574, 6.357]]]
    };
    expect(() => validateTerritoryGeometry(tooFew)).toThrow(InvalidGeometryError);
  });

  it('rejects an out-of-range longitude', () => {
    const badLongitude = {
      type: 'Polygon',
      coordinates: [
        [
          [-200, 6.357],
          [-75.572, 6.357],
          [-75.572, 6.359],
          [-200, 6.357]
        ]
      ]
    };
    expect(() => validateTerritoryGeometry(badLongitude)).toThrow(/WGS84 range/);
  });

  it('rejects an out-of-range latitude', () => {
    const badLatitude = {
      type: 'Polygon',
      coordinates: [
        [
          [-75.574, 95],
          [-75.572, 6.357],
          [-75.572, 6.359],
          [-75.574, 95]
        ]
      ]
    };
    expect(() => validateTerritoryGeometry(badLatitude)).toThrow(/WGS84 range/);
  });

  it('rejects a non-finite coordinate', () => {
    const nonFinite = {
      type: 'Polygon',
      coordinates: [
        [
          [Number.NaN, 6.357],
          [-75.572, 6.357],
          [-75.572, 6.359],
          [Number.NaN, 6.357]
        ]
      ]
    };
    expect(() => validateTerritoryGeometry(nonFinite)).toThrow(InvalidGeometryError);
  });

  it('rejects null, undefined, and non-object input', () => {
    for (const value of [null, undefined, 'polygon', 42, []]) {
      expect(() => validateTerritoryGeometry(value)).toThrow(InvalidGeometryError);
    }
  });

  it('every rejection carries the invalid_geometry code', () => {
    try {
      validateTerritoryGeometry({ type: 'Point', coordinates: [0, 0] });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidGeometryError);
      expect((error as InvalidGeometryError).code).toBe('invalid_geometry');
    }
  });
});
