/**
 * Structural type guards for RFC 7946 GeoJSON.
 *
 * Deliberate strictness choices, mirroring the database constraints (the
 * database remains the last line of defense — see db/migrations):
 *
 * - Empty coordinate arrays are rejected for every geometry type except
 *   GeometryCollection, which RFC 7946 explicitly allows to be empty.
 * - Polygon rings must be closed (first position equals last) with at least
 *   four positions, per RFC 7946 §3.1.6.
 * - `bbox` members are accepted but not validated.
 * - Guards are structural: isPosition checks shape, isWgs84Position adds the
 *   WGS84 coordinate ranges.
 */

import type {
  Feature,
  FeatureCollection,
  Geometry,
  GeometryCollection,
  LineString,
  MultiLineString,
  MultiPoint,
  MultiPolygon,
  Point,
  Polygon,
  Position
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positionsEqual(a: unknown, b: unknown): boolean {
  return (
    isPosition(a) &&
    isPosition(b) &&
    a.length === b.length &&
    a.every((component, index) => component === b[index])
  );
}

/**
 * Type guard for the position shape: an array of two or three finite numbers.
 * Deliberately structural — it does not judge coordinate-range validity.
 */
export function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    (value.length === 2 || value.length === 3) &&
    value.every(
      (component: unknown) => typeof component === 'number' && Number.isFinite(component)
    )
  );
}

/** Structural position guard plus WGS84 ranges: lon [-180, 180], lat [-90, 90]. */
export function isWgs84Position(value: unknown): value is Position {
  return isPosition(value) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}

/** A closed linear ring: >= 4 positions, first equals last (RFC 7946 §3.1.6). */
export function isLinearRing(value: unknown): value is readonly Position[] {
  return (
    Array.isArray(value) &&
    value.length >= 4 &&
    value.every(isPosition) &&
    positionsEqual(value[0], value[value.length - 1])
  );
}

export function isPoint(value: unknown): value is Point {
  return isRecord(value) && value.type === 'Point' && isPosition(value.coordinates);
}

export function isMultiPoint(value: unknown): value is MultiPoint {
  return (
    isRecord(value) &&
    value.type === 'MultiPoint' &&
    Array.isArray(value.coordinates) &&
    value.coordinates.length >= 1 &&
    value.coordinates.every(isPosition)
  );
}

export function isLineString(value: unknown): value is LineString {
  return (
    isRecord(value) &&
    value.type === 'LineString' &&
    Array.isArray(value.coordinates) &&
    value.coordinates.length >= 2 &&
    value.coordinates.every(isPosition)
  );
}

export function isMultiLineString(value: unknown): value is MultiLineString {
  return (
    isRecord(value) &&
    value.type === 'MultiLineString' &&
    Array.isArray(value.coordinates) &&
    value.coordinates.length >= 1 &&
    value.coordinates.every(
      (line: unknown) =>
        Array.isArray(line) && line.length >= 2 && line.every(isPosition)
    )
  );
}

export function isPolygon(value: unknown): value is Polygon {
  return (
    isRecord(value) &&
    value.type === 'Polygon' &&
    Array.isArray(value.coordinates) &&
    value.coordinates.length >= 1 &&
    value.coordinates.every(isLinearRing)
  );
}

export function isMultiPolygon(value: unknown): value is MultiPolygon {
  return (
    isRecord(value) &&
    value.type === 'MultiPolygon' &&
    Array.isArray(value.coordinates) &&
    value.coordinates.length >= 1 &&
    value.coordinates.every(
      (rings: unknown) =>
        Array.isArray(rings) && rings.length >= 1 && rings.every(isLinearRing)
    )
  );
}

export function isGeometryCollection(value: unknown): value is GeometryCollection {
  return (
    isRecord(value) &&
    value.type === 'GeometryCollection' &&
    Array.isArray(value.geometries) &&
    value.geometries.every(isGeometry)
  );
}

export function isGeometry(value: unknown): value is Geometry {
  return (
    isPoint(value) ||
    isMultiPoint(value) ||
    isLineString(value) ||
    isMultiLineString(value) ||
    isPolygon(value) ||
    isMultiPolygon(value) ||
    isGeometryCollection(value)
  );
}

export function isFeature(value: unknown): value is Feature {
  return (
    isRecord(value) &&
    value.type === 'Feature' &&
    'geometry' in value &&
    'properties' in value &&
    (value.geometry === null || isGeometry(value.geometry)) &&
    (value.properties === null || isRecord(value.properties))
  );
}

export function isFeatureCollection(value: unknown): value is FeatureCollection {
  return (
    isRecord(value) &&
    value.type === 'FeatureCollection' &&
    Array.isArray(value.features) &&
    value.features.every(isFeature)
  );
}
