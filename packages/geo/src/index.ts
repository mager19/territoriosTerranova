/**
 * Shared RFC 7946 (WGS84) GeoJSON types and validation helpers.
 *
 * Application-owned geometry is RFC 7946 WGS84 GeoJSON and is the system of
 * record (see AGENTS.md). Owned by the data agent (A2). The database remains
 * the last line of defense: these helpers validate at the edge, PostGIS
 * constraints enforce at rest (see db/migrations).
 */

export type {
  BBox,
  Feature,
  FeatureCollection,
  GeoJson,
  Geometry,
  GeometryCollection,
  LineString,
  LinearRing,
  MultiLineString,
  MultiPoint,
  MultiPolygon,
  Point,
  Polygon,
  Position
} from './types.js';

export {
  isFeature,
  isFeatureCollection,
  isGeometry,
  isGeometryCollection,
  isLineString,
  isLinearRing,
  isMultiLineString,
  isMultiPoint,
  isMultiPolygon,
  isPoint,
  isPolygon,
  isPosition,
  isWgs84Position
} from './guards.js';
