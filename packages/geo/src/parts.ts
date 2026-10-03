/**
 * Multi-part territory helpers (db/migrations/0012).
 *
 * A territory's geometry is a Polygon (one part) or a MultiPolygon (two or
 * more disjoint parts worked as ONE territory). The API contract is
 * "Polygon for one part, MultiPolygon for two or more": `combineParts`
 * produces exactly that shape, and every consumer reads parts through
 * `polygonParts` so single- and multi-part territories share one code path.
 */

import type { LinearRing, MultiPolygon, Polygon } from './types.js';

/** Territory geometry: one part (Polygon) or several disjoint parts (MultiPolygon). */
export type TerritoryGeometry = Polygon | MultiPolygon;

/** The parts of a territory geometry, each as a Polygon, in order. */
export function polygonParts(geometry: TerritoryGeometry): readonly Polygon[] {
  if (geometry.type === 'Polygon') {
    return [geometry];
  }
  return geometry.coordinates.map((rings) => ({ type: 'Polygon', coordinates: rings }));
}

/** Builds the canonical territory geometry: Polygon for one part, MultiPolygon otherwise. */
export function combineParts(parts: readonly Polygon[]): TerritoryGeometry {
  const [first] = parts;
  if (!first) {
    throw new Error('a territory geometry needs at least one part');
  }
  if (parts.length === 1) {
    return first;
  }
  return { type: 'MultiPolygon', coordinates: parts.map((part) => part.coordinates) };
}

/** Planar shoelace area of a ring in deg², orientation-independent. */
export function ringArea(ring: LinearRing): number {
  let twice = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index]!;
    const [x2, y2] = ring[index + 1]!;
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

/** Planar area of a polygon part: exterior minus holes, in deg². */
function partArea(part: Polygon): number {
  const [exterior, ...holes] = part.coordinates;
  if (!exterior) return 0;
  return holes.reduce((area, hole) => area - ringArea(hole), ringArea(exterior));
}

/**
 * The part with the largest planar area — where a single label or a
 * directions destination goes for a multi-part territory. Planar degrees
 * are fine for a comparison inside one municipality.
 */
export function largestPart(geometry: TerritoryGeometry): Polygon {
  const parts = polygonParts(geometry);
  let best = parts[0]!;
  let bestArea = partArea(best);
  for (const part of parts.slice(1)) {
    const area = partArea(part);
    if (area > bestArea) {
      best = part;
      bestArea = area;
    }
  }
  return best;
}
