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

import { isLineString, isPoint, isPolygon, isWgs84Position, type LineString, type Point, type Polygon } from '@territorios/geo';

import { InvalidGeometryError } from './errors.js';

function describeType(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'type' in value) {
    return JSON.stringify((value as { type: unknown }).type);
  }
  return typeof value;
}

function assertWgs84(positions: Iterable<readonly number[]>, context: string): void {
  let index = 0;
  for (const position of positions) {
    if (!isWgs84Position(position)) {
      throw new InvalidGeometryError(
        `${context} position ${index} is outside WGS84 range (longitude [-180, 180], latitude [-90, 90]): ${JSON.stringify(position)}`
      );
    }
    index += 1;
  }
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
  assertWgs84(value.coordinates.flat(), 'geometry');
  return value;
}

/**
 * Optional progress-entry geometries (pause point, route, remaining area).
 * `undefined`/`null` input means "not recorded" and returns `undefined` —
 * never an error, since these three fields are all optional on
 * progress_entries. Anything else must be well-formed or it is rejected,
 * never silently dropped.
 */
export function validateOptionalPausePoint(value: unknown): Point | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isPoint(value)) {
    throw new InvalidGeometryError(`pause point must be a GeoJSON Point, got ${describeType(value)}`);
  }
  assertWgs84([value.coordinates], 'pause point');
  return value;
}

export function validateOptionalRoute(value: unknown): LineString | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isLineString(value)) {
    throw new InvalidGeometryError(`route must be a GeoJSON LineString, got ${describeType(value)}`);
  }
  assertWgs84(value.coordinates, 'route');
  return value;
}

/**
 * Remaining-area geometry: application input is restricted to a single
 * Polygon (consistent with territory geometry being Polygon-only). A2's DB
 * constraint additionally accepts MultiPolygon for defense in depth against
 * any other future writer; this API never emits or requires that.
 */
export function validateOptionalRemainingArea(value: unknown): Polygon | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isPolygon(value)) {
    throw new InvalidGeometryError(
      `remaining-area geometry must be a GeoJSON Polygon with closed rings of at least 4 positions, got ${describeType(value)}`
    );
  }
  assertWgs84(value.coordinates.flat(), 'remaining-area geometry');
  return value;
}
