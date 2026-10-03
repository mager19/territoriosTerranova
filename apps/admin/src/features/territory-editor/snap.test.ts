import { describe, expect, it } from 'vitest';
import type { MultiPolygon, Polygon } from '@territorios/geo';

import { findOutsideVertexIndices, snapCoordinate, snapToGeometries, SNAP_TOLERANCE_PX, type Projector } from './snap.js';

/** 1 degree = 1000 px on both axes, y grows with latitude — enough to reason about pixels by hand. */
const project: Projector = ([lng, lat]) => ({ x: lng * 1000, y: lat * 1000 });

// A 40 x 40 px square: (0,0) to (40,40) in px, i.e. 0..0.04 degrees.
const BOUNDARY: Polygon = {
  type: 'Polygon',
  coordinates: [[[0, 0], [0.04, 0], [0.04, 0.04], [0, 0.04], [0, 0]]]
};

// Remaining area: the east half, plus a separate island, as a MultiPolygon.
const REMAINING: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [[[0.02, 0], [0.04, 0], [0.04, 0.04], [0.02, 0.04], [0.02, 0]]],
    [[[0.1, 0.1], [0.11, 0.1], [0.11, 0.11], [0.1, 0.1]]]
  ]
};

describe('snapCoordinate', () => {
  it('uses a ~12 px tolerance', () => {
    expect(SNAP_TOLERANCE_PX).toBe(12);
  });

  it('returns null when nothing is within tolerance, or there is nothing to snap to', () => {
    expect(snapCoordinate({ x: 20, y: 80 }, { boundary: BOUNDARY, remainingArea: REMAINING }, project)).toBeNull();
    expect(snapCoordinate({ x: 1, y: 1 }, { boundary: null, remainingArea: null }, project)).toBeNull();
  });

  it('snaps to a boundary vertex and returns its coordinate verbatim', () => {
    const snap = snapCoordinate({ x: 45, y: 46 }, { boundary: BOUNDARY, remainingArea: null }, project);
    expect(snap).toEqual({ coordinate: [0.04, 0.04], kind: 'vertex' });
  });

  it('prefers a vertex over a closer edge when both are within tolerance', () => {
    // 1 px from the bottom edge, 8.6 px from the (40,0) vertex.
    const snap = snapCoordinate({ x: 31.5, y: 1 }, { boundary: BOUNDARY, remainingArea: null }, project);
    expect(snap?.kind).toBe('vertex');
    expect(snap?.coordinate).toEqual([0.04, 0]);
  });

  it('prefers a boundary vertex over a nearer remaining-area vertex', () => {
    // 9.8 px from the remaining vertex (20,40), 11.7 px from the boundary vertex (40,40).
    const snap = snapCoordinate({ x: 29, y: 44 }, { boundary: BOUNDARY, remainingArea: REMAINING }, project);
    expect(snap).toEqual({ coordinate: [0.04, 0.04], kind: 'vertex' });
  });

  it('snaps to a remaining-area vertex when no boundary vertex is in range (including MultiPolygon parts)', () => {
    const middle = snapCoordinate({ x: 20, y: -3 }, { boundary: BOUNDARY, remainingArea: REMAINING }, project);
    // (20,0) is a remaining vertex; the boundary vertices (0,0)/(40,0) are 20 px away.
    expect(middle).toEqual({ coordinate: [0.02, 0], kind: 'vertex' });

    const island = snapCoordinate({ x: 112, y: 112 }, { boundary: BOUNDARY, remainingArea: REMAINING }, project);
    expect(island).toEqual({ coordinate: [0.11, 0.11], kind: 'vertex' });
  });

  it('snaps to the nearest point of a boundary edge when no vertex is in range', () => {
    const snap = snapCoordinate({ x: 14, y: -4 }, { boundary: BOUNDARY, remainingArea: null }, project);
    expect(snap?.kind).toBe('edge');
    expect(snap?.coordinate[0]).toBeCloseTo(0.014, 12);
    expect(snap?.coordinate[1]).toBe(0);
  });

  it('snaps to a remaining-area edge (the previous session border) too', () => {
    // 3 px east of the remaining area's west edge x=20; no vertex in range.
    const snap = snapCoordinate({ x: 23, y: 15 }, { boundary: BOUNDARY, remainingArea: REMAINING }, project);
    expect(snap?.kind).toBe('edge');
    expect(snap?.coordinate[0]).toBe(0.02);
    expect(snap?.coordinate[1]).toBeCloseTo(0.015, 12);
  });

  it('interpolates an edge snap geographically, so it lies on the straight lon/lat segment', () => {
    const diagonal: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [0.04, 0.02], [0, 0.04], [0, 0]]] };
    const snap = snapCoordinate({ x: 20, y: 12 }, { boundary: diagonal, remainingArea: null }, project);
    expect(snap?.kind).toBe('edge');
    const [lng, lat] = snap!.coordinate;
    // On the segment (0,0)-(0.04,0.02): lat = lng / 2.
    expect(lat).toBeCloseTo(lng / 2, 15);
  });

  it('ignores an empty remaining area (nothing left)', () => {
    const empty: Polygon = { type: 'Polygon', coordinates: [] };
    expect(snapCoordinate({ x: 50, y: 50 }, { boundary: null, remainingArea: empty }, project)).toBeNull();
  });

  it('honours a custom tolerance', () => {
    expect(snapCoordinate({ x: 45, y: 46 }, { boundary: BOUNDARY, remainingArea: null }, project, 5)).toBeNull();
  });
});

describe('snapToGeometries', () => {
  // Two neighbouring 10 x 10 px squares and a MultiPolygon barrio far to the east.
  const WEST: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]] };
  const EAST: Polygon = { type: 'Polygon', coordinates: [[[0.03, 0], [0.04, 0], [0.04, 0.01], [0.03, 0.01], [0.03, 0]]] };
  const BARRIO: MultiPolygon = {
    type: 'MultiPolygon',
    coordinates: [
      [[[0.1, 0], [0.12, 0], [0.12, 0.02], [0.1, 0]]],
      [[[0.2, 0], [0.22, 0], [0.22, 0.02], [0.2, 0]]]
    ]
  };

  it('returns null with no geometries or nothing in range', () => {
    expect(snapToGeometries({ x: 5, y: 5 }, [], project)).toBeNull();
    expect(snapToGeometries({ x: 20, y: 50 }, [WEST, EAST, BARRIO], project)).toBeNull();
  });

  it('snaps to the nearest vertex across every geometry, regardless of order', () => {
    // 8.5 px from WEST (10,10), 5 px from EAST (30,10) -> EAST wins: one tier, nearest vertex.
    expect(snapToGeometries({ x: 25, y: 10 }, [WEST, EAST], project)).toEqual({ coordinate: [0.03, 0.01], kind: 'vertex' });
  });

  it('snaps to a vertex of any MultiPolygon part', () => {
    expect(snapToGeometries({ x: 218, y: 22 }, [WEST, BARRIO], project)).toEqual({ coordinate: [0.22, 0.02], kind: 'vertex' });
  });

  it('prefers a vertex of one geometry over a closer edge of another', () => {
    // BIG's bottom edge is 2 px away (its vertices 50 px); SPIKE's tip vertex is 10 px away.
    const big: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]]] };
    const spike: Polygon = { type: 'Polygon', coordinates: [[[0.05, -0.008], [0.06, -0.1], [0.04, -0.1], [0.05, -0.008]]] };
    expect(snapToGeometries({ x: 50, y: 2 }, [big], project)?.kind).toBe('edge');
    expect(snapToGeometries({ x: 50, y: 2 }, [big, spike], project)).toEqual({ coordinate: [0.05, -0.008], kind: 'vertex' });
  });

  it('snaps to the nearest edge point when no vertex is in range, interpolating geographically', () => {
    const snap = snapToGeometries({ x: 105, y: 20 }, [BARRIO], project);
    // (0.105, 0.02) is ~10.6 px from the diagonal (0.1,0)-(0.12,0.02) and 15 px+ from any vertex.
    expect(snap?.kind).toBe('edge');
    const [lng, lat] = snap!.coordinate;
    expect(lat).toBeCloseTo(lng - 0.1, 15);
  });
});

describe('findOutsideVertexIndices', () => {
  it('returns no indices without a boundary', () => {
    expect(findOutsideVertexIndices([[5, 5]], null)).toEqual([]);
  });

  it('flags only the vertices outside the boundary', () => {
    const vertices = [
      [0.005, 0.005],
      [0.05, 0.005],
      [0.015, 0.015],
      [-0.001, 0.01]
    ] as const;
    expect(findOutsideVertexIndices(vertices, BOUNDARY)).toEqual([1, 3]);
  });

  it('treats points exactly on the boundary (vertices and edges) as inside', () => {
    const vertices = [
      [0, 0],
      [0.02, 0],
      [0.04, 0.013],
      [0, 0.04]
    ] as const;
    expect(findOutsideVertexIndices(vertices, BOUNDARY)).toEqual([]);
  });

  it('treats a point within a tiny epsilon of a diagonal edge as inside', () => {
    const diagonal: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [0.04, 0.02], [0, 0.04], [0, 0]]] };
    const t = 0.37;
    const onEdge = [0.04 * t, 0.02 * t] as const;
    const slightlyOut = [0.04 * t + 1e-12, 0.02 * t - 1e-12] as const;
    expect(findOutsideVertexIndices([onEdge, slightlyOut], diagonal)).toEqual([]);
  });

  it('treats a point inside a hole as outside', () => {
    const withHole: Polygon = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02], [0, 0]],
        [[0.005, 0.005], [0.015, 0.005], [0.015, 0.015], [0.005, 0.015], [0.005, 0.005]]
      ]
    };
    expect(findOutsideVertexIndices([[0.01, 0.01], [0.002, 0.002]], withHole)).toEqual([0]);
  });
});
