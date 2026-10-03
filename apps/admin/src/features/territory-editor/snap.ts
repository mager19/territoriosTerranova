/**
 * Snapping and outside-vertex detection, shared by the session recorder
 * and the territory editor (2026-10-03). Pure: no MapLibre, no DOM. The caller passes a projector
 * (MapLibre's map.project in the app, a linear stand-in in tests), so the
 * tolerance is measured in screen pixels — what the administrator can
 * actually see — while every returned coordinate is geographic.
 *
 * Why it exists: covered areas drawn by hand along the territory border
 * landed a few metres outside it, and the server rejected the session as
 * out_of_bounds. Snapping puts a vertex EXACTLY on the border instead; the
 * server tolerates 5 cm of floating-point overshoot for the edge case
 * (apps/api/src/domain/progress.ts, CONTAINMENT_TOLERANCE_METERS).
 *
 * TerritoryEditor reuses the same snapping (snapToGeometries) against the
 * neighbouring territories and the selected AMVA reference barrio, so a
 * new territory can share an exact border with its neighbours instead of
 * leaving slivers or tiny overlaps the server would reject.
 */

import type { MultiPolygon, Polygon, Position } from '@territorios/geo';

import type { Coordinate } from './draft.js';

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** Geographic [lon, lat] -> screen pixel. */
export type Projector = (coordinate: Coordinate) => ScreenPoint;

export interface SnapSources {
  readonly boundary: Polygon | null;
  /** Current remaining area of the cycle; null (unknown) or an empty polygon (nothing left) contributes nothing. */
  readonly remainingArea: Polygon | MultiPolygon | null;
}

export interface SnapResult {
  readonly coordinate: Coordinate;
  readonly kind: 'vertex' | 'edge';
}

export type SnapGeometry = Polygon | MultiPolygon;

export const SNAP_TOLERANCE_PX = 12;

/**
 * Degrees within which a point counts as ON the boundary for the client
 * pre-check (~0.1 mm). Large enough to absorb the float error of an edge
 * snap, far smaller than anything a person could draw.
 */
const ON_BOUNDARY_EPSILON_DEGREES = 1e-9;

type Ring = readonly Position[];

function polygonRings(geometry: SnapGeometry | null): Ring[] {
  if (geometry === null) return [];
  if (geometry.type === 'Polygon') return [...geometry.coordinates];
  return geometry.coordinates.flat();
}

/** Ring positions without the repeated closing position. */
function ringVertices(ring: Ring): Ring {
  if (ring.length < 2) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
}

function toCoordinate(position: Position): Coordinate {
  return [position[0]!, position[1]!];
}

function nearestVertex(point: ScreenPoint, rings: readonly Ring[], project: Projector, tolerance: number): Coordinate | null {
  let best: Coordinate | null = null;
  let bestDistance = tolerance;
  for (const ring of rings) {
    for (const position of ringVertices(ring)) {
      const coordinate = toCoordinate(position);
      const screen = project(coordinate);
      const distance = Math.hypot(point.x - screen.x, point.y - screen.y);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = coordinate;
      }
    }
  }
  return best;
}

/**
 * The closest point to `point` on any ring edge, within tolerance. The
 * parameter t along the edge is found in SCREEN space (what the user sees),
 * then the coordinate is interpolated GEOGRAPHICALLY between the edge's two
 * endpoints — not unprojected. That keeps the result on the straight
 * lon/lat segment PostGIS tests containment against (Web Mercator bends
 * that segment slightly on screen; at territory scale the difference is
 * invisible, but unprojecting would land off the server's edge).
 */
function nearestEdgePoint(point: ScreenPoint, rings: readonly Ring[], project: Projector, tolerance: number): Coordinate | null {
  let best: Coordinate | null = null;
  let bestDistance = tolerance;
  for (const ring of rings) {
    const vertices = ringVertices(ring);
    if (vertices.length < 2) continue;
    for (let i = 0; i < vertices.length; i += 1) {
      const a = toCoordinate(vertices[i]!);
      const b = toCoordinate(vertices[(i + 1) % vertices.length]!);
      const sa = project(a);
      const sb = project(b);
      const dx = sb.x - sa.x;
      const dy = sb.y - sa.y;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - sa.x) * dx + (point.y - sa.y) * dy) / lengthSquared));
      const distance = Math.hypot(point.x - (sa.x + t * dx), point.y - (sa.y + t * dy));
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
    }
  }
  return best;
}

/**
 * Where a click/drag at `point` should land, or null to use the raw point.
 * `vertexTiers` is checked in order: a vertex in range from an earlier tier
 * wins over any later tier; within a tier the nearest vertex wins. Only when
 * no vertex at all is in range does the nearest point on any edge (of any
 * tier) apply. A vertex in range always wins over an edge, even a closer
 * one, so corners are easy to hit.
 */
function snapToTiers(
  point: ScreenPoint,
  vertexTiers: readonly (readonly Ring[])[],
  project: Projector,
  tolerancePx: number
): SnapResult | null {
  for (const rings of vertexTiers) {
    const vertex = nearestVertex(point, rings, project, tolerancePx);
    if (vertex) return { coordinate: vertex, kind: 'vertex' };
  }
  const edgePoint = nearestEdgePoint(point, vertexTiers.flat(), project, tolerancePx);
  return edgePoint ? { coordinate: edgePoint, kind: 'edge' } : null;
}

/**
 * Session recorder snapping. Priority: boundary vertices, then
 * remaining-area vertices, then the nearest point on any boundary or
 * remaining-area edge.
 */
export function snapCoordinate(
  point: ScreenPoint,
  sources: SnapSources,
  project: Projector,
  tolerancePx: number = SNAP_TOLERANCE_PX
): SnapResult | null {
  return snapToTiers(point, [polygonRings(sources.boundary), polygonRings(sources.remainingArea)], project, tolerancePx);
}

/**
 * Territory editor snapping: every geometry is one tier — the nearest
 * vertex of any of them wins, then the nearest point on any of their edges.
 */
export function snapToGeometries(
  point: ScreenPoint,
  geometries: readonly SnapGeometry[],
  project: Projector,
  tolerancePx: number = SNAP_TOLERANCE_PX
): SnapResult | null {
  return snapToTiers(point, [geometries.flatMap((geometry) => polygonRings(geometry))], project, tolerancePx);
}

function distanceToSegmentDegrees(p: Coordinate, a: Position, b: Position): number {
  const ax = a[0]!;
  const ay = a[1]!;
  const dx = b[0]! - ax;
  const dy = b[1]! - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / lengthSquared));
  return Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
}

function isOnRing(p: Coordinate, ring: Ring): boolean {
  for (let i = 0; i + 1 < ring.length; i += 1) {
    if (distanceToSegmentDegrees(p, ring[i]!, ring[i + 1]!) <= ON_BOUNDARY_EPSILON_DEGREES) return true;
  }
  return false;
}

/** Even-odd ray casting; the closing position of an RFC 7946 ring makes every edge explicit. */
function crossesRing(p: Coordinate, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function isInsidePolygon(p: Coordinate, polygon: Polygon): boolean {
  const rings = polygon.coordinates;
  // On any ring (outer edge or hole edge) counts as inside: snapped points
  // sit exactly there and the server accepts them.
  if (rings.some((ring) => isOnRing(p, ring))) return true;
  // Even-odd across all rings: inside the outer ring and outside every hole.
  return rings.reduce((inside, ring) => (crossesRing(p, ring) ? !inside : inside), false);
}

/**
 * Indices of draft vertices that lie outside the territory boundary — a
 * client pre-check so the administrator sees which points to move before
 * the server rejects the session. Points on the boundary (within ~0.1 mm)
 * count as inside. No boundary: nothing can be judged, nothing is flagged.
 */
export function findOutsideVertexIndices(vertices: readonly Coordinate[], boundary: Polygon | null): number[] {
  if (boundary === null || boundary.coordinates.length === 0) return [];
  const outside: number[] = [];
  vertices.forEach((vertex, index) => {
    if (!isInsidePolygon(vertex, boundary)) outside.push(index);
  });
  return outside;
}
