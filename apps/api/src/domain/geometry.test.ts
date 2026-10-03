import { describe, expect, it } from 'vitest';

import {
  validateOptionalPausePoint,
  validateCoveredArea,
  validateOptionalBaseline,
  validateOptionalRoute,
  validateTerritoryGeometry
} from './geometry.js';
import { InvalidGeometryError, ValidationError } from './errors.js';

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

  it('accepts a MultiPolygon of several parts (multi-part territories, 0012)', () => {
    const second = VALID_SQUARE.coordinates.map((ring) => ring.map(([x, y]) => [x + 0.01, y]));
    const multi = { type: 'MultiPolygon', coordinates: [VALID_SQUARE.coordinates, second] };
    expect(validateTerritoryGeometry(multi)).toEqual(multi);
  });

  it('normalizes a one-part MultiPolygon to its Polygon (one canonical shape per territory)', () => {
    const multi = { type: 'MultiPolygon', coordinates: [VALID_SQUARE.coordinates] };
    expect(validateTerritoryGeometry(multi)).toEqual(VALID_SQUARE);
  });

  it('rejects a MultiPolygon with an unclosed ring in any part', () => {
    const open = [[[-75.574, 6.357], [-75.572, 6.357], [-75.572, 6.359]]];
    const multi = { type: 'MultiPolygon', coordinates: [VALID_SQUARE.coordinates, open] };
    expect(() => validateTerritoryGeometry(multi)).toThrow(InvalidGeometryError);
  });

  it('rejects a MultiPolygon with an out-of-range position in any part', () => {
    const bad = [[[-200, 6.357], [-75.572, 6.357], [-75.572, 6.359], [-200, 6.357]]];
    const multi = { type: 'MultiPolygon', coordinates: [VALID_SQUARE.coordinates, bad] };
    expect(() => validateTerritoryGeometry(multi)).toThrow(/WGS84 range/);
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

describe('validateOptionalPausePoint', () => {
  it('returns undefined for undefined and null — "not recorded" is never an error', () => {
    expect(validateOptionalPausePoint(undefined)).toBeUndefined();
    expect(validateOptionalPausePoint(null)).toBeUndefined();
  });

  it('accepts a well-formed WGS84 Point', () => {
    const point = { type: 'Point', coordinates: [-75.573, 6.358] };
    expect(validateOptionalPausePoint(point)).toEqual(point);
  });

  it('rejects a non-Point type', () => {
    expect(() => validateOptionalPausePoint({ type: 'Polygon', coordinates: [] })).toThrow(InvalidGeometryError);
  });

  it('rejects an out-of-range coordinate', () => {
    expect(() => validateOptionalPausePoint({ type: 'Point', coordinates: [-200, 6.358] })).toThrow(/WGS84 range/);
  });
});

describe('validateOptionalRoute', () => {
  it('returns undefined for undefined and null', () => {
    expect(validateOptionalRoute(undefined)).toBeUndefined();
    expect(validateOptionalRoute(null)).toBeUndefined();
  });

  it('accepts a well-formed WGS84 LineString', () => {
    const route = { type: 'LineString', coordinates: [[-75.574, 6.357], [-75.572, 6.359]] };
    expect(validateOptionalRoute(route)).toEqual(route);
  });

  it('rejects a non-LineString type', () => {
    expect(() => validateOptionalRoute({ type: 'Point', coordinates: [0, 0] })).toThrow(InvalidGeometryError);
  });

  it('rejects an out-of-range coordinate anywhere along the route', () => {
    const route = { type: 'LineString', coordinates: [[-75.574, 6.357], [-75.572, 95]] };
    expect(() => validateOptionalRoute(route)).toThrow(/WGS84 range/);
  });
});

describe('validateCoveredArea', () => {
  const validArea = {
    type: 'Polygon',
    coordinates: [[[-75.574, 6.357], [-75.572, 6.357], [-75.572, 6.359], [-75.574, 6.357]]]
  };

  it('requires a covered area — a new session without one is rejected as an invalid request', () => {
    expect(() => validateCoveredArea(undefined)).toThrow(ValidationError);
    expect(() => validateCoveredArea(null)).toThrow(/coveredArea is required/);
  });

  it('accepts a well-formed WGS84 Polygon', () => {
    expect(validateCoveredArea(validArea)).toEqual(validArea);
  });

  it('rejects a MultiPolygon (application input is single-Polygon only)', () => {
    expect(() => validateCoveredArea({ type: 'MultiPolygon', coordinates: [validArea.coordinates] })).toThrow(
      InvalidGeometryError
    );
  });

  it('rejects an out-of-range coordinate', () => {
    const bad = { type: 'Polygon', coordinates: [[[-75.574, 6.357], [-200, 6.357], [-75.572, 6.359], [-75.574, 6.357]]] };
    expect(() => validateCoveredArea(bad)).toThrow(/WGS84 range/);
  });
});

describe('validateOptionalBaseline', () => {
  it('returns undefined when no baseline was confirmed — never a default', () => {
    expect(validateOptionalBaseline(undefined)).toBeUndefined();
    expect(validateOptionalBaseline(null)).toBeUndefined();
  });

  it("accepts the explicit 'whole_territory' confirmation", () => {
    expect(validateOptionalBaseline('whole_territory')).toBe('whole_territory');
  });

  it('rejects any other value', () => {
    expect(() => validateOptionalBaseline('everything')).toThrow(ValidationError);
    expect(() => validateOptionalBaseline(true)).toThrow(/baseline/);
  });
});
