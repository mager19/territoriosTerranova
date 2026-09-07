import { describe, expect, it } from 'vitest';

import {
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
  isWgs84Position
} from './index.js';

// Closed square around the verified Bello sample vertex from
// docs/map-references.md (AMVA layer 9, outSR=4326):
// [-75.57307274994052, 6.358147322663799], rounded to ±0.001° corners.
const BELLO_SQUARE = [
  [-75.5741, 6.3571],
  [-75.5721, 6.3571],
  [-75.5721, 6.3591],
  [-75.5741, 6.3591],
  [-75.5741, 6.3571]
] as const;

describe('isWgs84Position', () => {
  it('accepts in-range positions, including the range limits', () => {
    expect(isWgs84Position([-75.57307274994052, 6.358147322663799])).toBe(true);
    expect(isWgs84Position([-180, -90])).toBe(true);
    expect(isWgs84Position([180, 90, 1500])).toBe(true);
  });

  it('rejects out-of-range longitude and latitude', () => {
    expect(isWgs84Position([-180.0001, 6.35])).toBe(false);
    expect(isWgs84Position([180.0001, 6.35])).toBe(false);
    expect(isWgs84Position([-75.57, 90.0001])).toBe(false);
    expect(isWgs84Position([-75.57, -90.0001])).toBe(false);
  });

  it('rejects everything the structural guard rejects', () => {
    expect(isWgs84Position([-75.57])).toBe(false);
    expect(isWgs84Position(['-75.57', '6.35'])).toBe(false);
    expect(isWgs84Position(null)).toBe(false);
  });
});

describe('isLinearRing', () => {
  it('accepts a closed ring of four or more positions', () => {
    expect(isLinearRing(BELLO_SQUARE)).toBe(true);
  });

  it('rejects an unclosed ring', () => {
    expect(isLinearRing(BELLO_SQUARE.slice(0, 4))).toBe(false);
  });

  it('rejects fewer than four positions even when first equals last', () => {
    const p = [-75.573, 6.358];
    expect(isLinearRing([p, p, p])).toBe(false);
  });

  it('rejects non-position members', () => {
    expect(isLinearRing([[-75.574, 6.357], [-75.572, 6.357], [-75.572, 'x'], [-75.574, 6.357]])).toBe(false);
  });
});

describe('geometry guards', () => {
  it('isPoint accepts a position and rejects near-misses', () => {
    expect(isPoint({ type: 'Point', coordinates: [-75.573, 6.358] })).toBe(true);
    expect(isPoint({ type: 'Point', coordinates: [] })).toBe(false);
    expect(isPoint({ type: 'Point' })).toBe(false);
    expect(isPoint({ type: 'point', coordinates: [-75.573, 6.358] })).toBe(false);
  });

  it('isMultiPoint requires at least one position', () => {
    expect(isMultiPoint({ type: 'MultiPoint', coordinates: [[-75.573, 6.358]] })).toBe(true);
    expect(isMultiPoint({ type: 'MultiPoint', coordinates: [] })).toBe(false);
  });

  it('isLineString requires at least two positions', () => {
    expect(
      isLineString({ type: 'LineString', coordinates: [[-75.574, 6.357], [-75.572, 6.359]] })
    ).toBe(true);
    expect(isLineString({ type: 'LineString', coordinates: [[-75.574, 6.357]] })).toBe(false);
  });

  it('isMultiLineString requires at least one line of two positions', () => {
    expect(
      isMultiLineString({
        type: 'MultiLineString',
        coordinates: [[[-75.574, 6.357], [-75.572, 6.359]]]
      })
    ).toBe(true);
    expect(isMultiLineString({ type: 'MultiLineString', coordinates: [] })).toBe(false);
    expect(isMultiLineString({ type: 'MultiLineString', coordinates: [[[-75.574, 6.357]]] })).toBe(
      false
    );
  });

  it('isPolygon accepts a ring and a ring with a hole', () => {
    expect(isPolygon({ type: 'Polygon', coordinates: [BELLO_SQUARE] })).toBe(true);
    expect(isPolygon({ type: 'Polygon', coordinates: [BELLO_SQUARE, BELLO_SQUARE] })).toBe(true);
  });

  it('isPolygon rejects empty, unclosed, and malformed rings', () => {
    expect(isPolygon({ type: 'Polygon', coordinates: [] })).toBe(false);
    expect(isPolygon({ type: 'Polygon', coordinates: [BELLO_SQUARE.slice(0, 4)] })).toBe(false);
    expect(isPolygon({ type: 'Polygon', coordinates: BELLO_SQUARE })).toBe(false);
  });

  it('isMultiPolygon accepts nested rings and rejects shallow nesting', () => {
    expect(isMultiPolygon({ type: 'MultiPolygon', coordinates: [[BELLO_SQUARE]] })).toBe(true);
    expect(isMultiPolygon({ type: 'MultiPolygon', coordinates: [BELLO_SQUARE] })).toBe(false);
    expect(isMultiPolygon({ type: 'MultiPolygon', coordinates: [] })).toBe(false);
  });

  it('isGeometryCollection allows an empty collection per RFC 7946', () => {
    expect(isGeometryCollection({ type: 'GeometryCollection', geometries: [] })).toBe(true);
    expect(
      isGeometryCollection({
        type: 'GeometryCollection',
        geometries: [{ type: 'Point', coordinates: [-75.573, 6.358] }]
      })
    ).toBe(true);
    expect(
      isGeometryCollection({
        type: 'GeometryCollection',
        geometries: [{ type: 'Point', coordinates: [] }]
      })
    ).toBe(false);
  });

  it('isGeometry dispatches across all geometry types', () => {
    expect(isGeometry({ type: 'Point', coordinates: [-75.573, 6.358] })).toBe(true);
    expect(isGeometry({ type: 'Polygon', coordinates: [BELLO_SQUARE] })).toBe(true);
    expect(isGeometry({ type: 'Feature', geometry: null, properties: null })).toBe(false);
    expect(isGeometry({ type: 'Polygon', coordinates: [] })).toBe(false);
  });
});

describe('feature guards', () => {
  const feature = {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [BELLO_SQUARE] },
    properties: { Nombre: 'Bello Centro' },
    id: 42
  };

  it('isFeature accepts a located feature and an unlocated one', () => {
    expect(isFeature(feature)).toBe(true);
    expect(isFeature({ type: 'Feature', geometry: null, properties: null })).toBe(true);
  });

  it('isFeature rejects missing members and bad geometry', () => {
    expect(isFeature({ type: 'Feature', geometry: null })).toBe(false);
    expect(isFeature({ type: 'Feature', properties: null })).toBe(false);
    expect(
      isFeature({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: null })
    ).toBe(false);
    expect(isFeature({ type: 'Feature', geometry: null, properties: [1, 2] })).toBe(false);
  });

  it('isFeatureCollection validates every member', () => {
    expect(isFeatureCollection({ type: 'FeatureCollection', features: [feature] })).toBe(true);
    expect(isFeatureCollection({ type: 'FeatureCollection', features: [] })).toBe(true);
    expect(
      isFeatureCollection({ type: 'FeatureCollection', features: [feature, { type: 'Feature' }] })
    ).toBe(false);
    expect(isFeatureCollection({ type: 'FeatureCollection' })).toBe(false);
  });
});
