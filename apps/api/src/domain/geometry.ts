/**
 * Structural, client-side validation for territory geometry — the first of
 * two defense layers (AGENTS.md: "the database is the last line of
 * defense", not the only one). This layer catches what PostGIS cannot check
 * as precisely as WGS84 coordinate range, and rejects non-Polygon types
 * before a wasted round trip.
 *
 * Validity (self-intersection) and area are left to PostGIS: A2's migration
 * documents a measured epsilon (1e-12 deg²) that this layer must not
 * duplicate and risk drifting out of sync with.
 */

import { isPolygon, isWgs84Position, type Polygon } from '@territorios/geo';

import { InvalidGeometryError } from './errors.js';

function describeType(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'type' in value) {
    return JSON.stringify((value as { type: unknown }).type);
  }
  return typeof value;
}

/**
 * Validates that `value` is a structurally well-formed RFC 7946 Polygon
 * (closed rings, >= 4 positions each) with every position inside WGS84
 * coordinate ranges. Throws InvalidGeometryError otherwise — never repairs,
 * never guesses.
 */
export function validateTerritoryGeometry(value: unknown): Polygon {
  if (!isPolygon(value)) {
    throw new InvalidGeometryError(
      `geometry must be a GeoJSON Polygon with closed rings of at least 4 positions, got ${describeType(value)}`
    );
  }

  for (const [ringIndex, ring] of value.coordinates.entries()) {
    for (const [positionIndex, position] of ring.entries()) {
      if (!isWgs84Position(position)) {
        throw new InvalidGeometryError(
          `geometry position at ring ${ringIndex}, index ${positionIndex} is outside WGS84 range ` +
            `(longitude [-180, 180], latitude [-90, 90]): ${JSON.stringify(position)}`
        );
      }
    }
  }

  return value;
}
