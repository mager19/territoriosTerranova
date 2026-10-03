/**
 * Structural, client-side validation for territory geometry — the first of
 * two defense layers (AGENTS.md: "the database is the last line of
 * defense", not the only one). This layer catches what PostGIS cannot check
 * as precisely as WGS84 coordinate range, and rejects non-polygonal types
 * before a wasted round trip.
 *
 * Validity (self-intersection) and area are left to PostGIS: A2's migration
 * documents a measured epsilon (1e-12 deg²) that this layer must not
 * duplicate and risk drifting out of sync with.
 */

import {
  combineParts,
  isLineString,
  isMultiPolygon,
  isPoint,
  isPolygon,
  isWgs84Position,
  polygonParts,
  type LineString,
  type Point,
  type Polygon,
  type TerritoryGeometry
} from '@territorios/geo';

import { InvalidGeometryError, ValidationError } from './errors.js';

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
 * Validates that `value` is a structurally well-formed RFC 7946 Polygon or
 * MultiPolygon (closed rings, >= 4 positions each, in every part) with every
 * position inside WGS84 coordinate ranges. Throws InvalidGeometryError
 * otherwise — never repairs, never guesses.
 *
 * Multi-part territories (db/migrations/0012): the result is canonical — a
 * Polygon for one part, a MultiPolygon for two or more — so a one-part
 * MultiPolygon comes back as its Polygon. That is a change of wrapper only,
 * never of coordinates. Whether parts overlap or touch each other, have
 * area, or sit inside Bello is decided by PostGIS, never here.
 */
export function validateTerritoryGeometry(value: unknown): TerritoryGeometry {
  if (!isPolygon(value) && !isMultiPolygon(value)) {
    throw new InvalidGeometryError(
      `geometry must be a GeoJSON Polygon or MultiPolygon with closed rings of at least 4 positions, got ${describeType(value)}`
    );
  }
  const parts = polygonParts(value);
  assertWgs84(
    parts.flatMap((part) => part.coordinates.flat()),
    'geometry'
  );
  return combineParts(parts);
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
 * Covered-area geometry: REQUIRED on every new progress session (2026-09-26
 * product decision — the administrator draws what was covered that session;
 * the server derives the remaining area from it). Application input is
 * restricted to a single Polygon: one session draws one covered shape (a
 * multi-part territory records one session per part); the DB constraint
 * (0007) additionally accepts MultiPolygon for defense in depth. Validity, zero area, and containment are decided by
 * PostGIS inside the recording transaction, never here.
 */
export function validateCoveredArea(value: unknown): Polygon {
  if (value === undefined || value === null) {
    throw new ValidationError('coveredArea is required: draw the area covered in this session');
  }
  if (!isPolygon(value)) {
    throw new InvalidGeometryError(
      `covered-area geometry must be a GeoJSON Polygon with closed rings of at least 4 positions, got ${describeType(value)}`
    );
  }
  assertWgs84(value.coordinates.flat(), 'covered-area geometry');
  return value;
}

export type CoverageBaseline = 'whole_territory';

/**
 * The explicit baseline an administrator confirms for the first coverage
 * session of a cycle. Absent means "no baseline confirmed" — never a default.
 */
export function validateOptionalBaseline(value: unknown): CoverageBaseline | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value !== 'whole_territory') {
    throw new ValidationError(`baseline must be 'whole_territory' when provided, got ${JSON.stringify(value)}`);
  }
  return value;
}
