/**
 * RFC 7946 (WGS84) GeoJSON types.
 *
 * Application-owned geometry is RFC 7946 WGS84 GeoJSON and is the system of
 * record (see AGENTS.md). These types describe exactly what the database
 * accepts: SRID 4326, valid non-empty polygons with positive area.
 */

/**
 * An RFC 7946 position: [longitude, latitude] with optional elevation.
 * Coordinates are WGS84 degrees; longitude in [-180, 180], latitude in
 * [-90, 90]. Use isWgs84Position to enforce the ranges.
 */
export type Position = readonly [number, number] | readonly [number, number, number];

/**
 * A closed ring: four or more positions where the first and last are equal
 * (RFC 7946 §3.1.6). The first ring is the exterior; any others are holes.
 */
export type LinearRing = readonly Position[];

/** RFC 7946 §5 bounding box: [west, south, east, north] (+ optional elevation). */
export type BBox =
  | readonly [number, number, number, number]
  | readonly [number, number, number, number, number, number];

export interface Point {
  readonly type: 'Point';
  readonly coordinates: Position;
  readonly bbox?: BBox;
}

export interface MultiPoint {
  readonly type: 'MultiPoint';
  readonly coordinates: readonly Position[];
  readonly bbox?: BBox;
}

export interface LineString {
  readonly type: 'LineString';
  readonly coordinates: readonly Position[];
  readonly bbox?: BBox;
}

export interface MultiLineString {
  readonly type: 'MultiLineString';
  readonly coordinates: readonly (readonly Position[])[];
  readonly bbox?: BBox;
}

export interface Polygon {
  readonly type: 'Polygon';
  readonly coordinates: readonly LinearRing[];
  readonly bbox?: BBox;
}

export interface MultiPolygon {
  readonly type: 'MultiPolygon';
  readonly coordinates: readonly (readonly LinearRing[])[];
  readonly bbox?: BBox;
}

export interface GeometryCollection {
  readonly type: 'GeometryCollection';
  readonly geometries: readonly Geometry[];
  readonly bbox?: BBox;
}

export type Geometry =
  | Point
  | MultiPoint
  | LineString
  | MultiLineString
  | Polygon
  | MultiPolygon
  | GeometryCollection;

/**
 * A GeoJSON Feature. `geometry` is null for unlocated features (RFC 7946
 * §3.2); `properties` is null or a plain object.
 */
export interface Feature<G extends Geometry = Geometry> {
  readonly type: 'Feature';
  readonly geometry: G | null;
  readonly properties: Readonly<Record<string, unknown>> | null;
  readonly id?: string | number;
  readonly bbox?: BBox;
}

export interface FeatureCollection<G extends Geometry = Geometry> {
  readonly type: 'FeatureCollection';
  readonly features: readonly Feature<G>[];
  readonly bbox?: BBox;
}

/** Any GeoJSON object: a geometry, feature, or feature collection. */
export type GeoJson = Geometry | Feature | FeatureCollection;
