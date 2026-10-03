import { describe, expect, it } from 'vitest';
import type { MultiPolygon, Polygon } from '@territorios/geo';

import {
  createTerritoryLabelElement,
  hasDrawableArea,
  LAYER_COLORS,
  legendItems,
  territoryLabelPoint,
  territoryStartPoint
} from './layers.js';

/** Ray-casting point-in-ring, independent of the code under test. */
function insideRing([x, y]: readonly [number, number], ring: readonly (readonly number[])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const SQUARE: Polygon = {
  type: 'Polygon',
  coordinates: [[[-75.574, 6.357], [-75.572, 6.357], [-75.572, 6.359], [-75.574, 6.359], [-75.574, 6.357]]]
};
const EMPTY: Polygon = { type: 'Polygon', coordinates: [] };

describe('hasDrawableArea', () => {
  it('draws a real Polygon or MultiPolygon', () => {
    expect(hasDrawableArea(SQUARE)).toBe(true);
    expect(hasDrawableArea({ type: 'MultiPolygon', coordinates: [SQUARE.coordinates] })).toBe(true);
  });

  it('draws nothing for null or the explicit empty polygon', () => {
    expect(hasDrawableArea(null)).toBe(false);
    expect(hasDrawableArea(EMPTY)).toBe(false);
  });
});

describe('legendItems', () => {
  it('gives the done area its own distinct color from the pending area', () => {
    const items = legendItems({ coveredArea: SQUARE, remainingArea: SQUARE, route: null });

    expect(items.map((item) => [item.label, item.color])).toEqual([
      ['Hecho', LAYER_COLORS.covered],
      ['Pendiente', LAYER_COLORS.remaining]
    ]);
    expect(LAYER_COLORS.covered).not.toBe(LAYER_COLORS.remaining);
  });

  it('omits an empty covered area — nothing done yet has nothing to explain', () => {
    const items = legendItems({ coveredArea: EMPTY, remainingArea: null, route: null });

    expect(items).toEqual([]);
  });

  it('never lists a pause point — removed from the public view on 2026-10-03', () => {
    const items = legendItems({ coveredArea: SQUARE, remainingArea: SQUARE, route: null });

    expect(items.map((item) => item.key)).toEqual(['covered', 'remaining']);
    expect(Object.keys(LAYER_COLORS)).not.toContain('pausePoint');
  });
});

describe('territoryLabelPoint', () => {
  it('puts the label at the middle of a simple territory', () => {
    const [lon, lat] = territoryLabelPoint(SQUARE);

    expect(lon).toBeCloseTo(-75.573, 4);
    expect(lat).toBeCloseTo(6.358, 4);
  });

  it('keeps the label inside an L-shaped territory, where the bounding-box center falls outside', () => {
    // An L: a tall west arm plus a short east foot. Its bounding-box center
    // (-75.571, 6.358) is in the empty notch, outside the territory.
    const lShape: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-75.574, 6.354],
          [-75.568, 6.354],
          [-75.568, 6.356],
          [-75.572, 6.356],
          [-75.572, 6.362],
          [-75.574, 6.362],
          [-75.574, 6.354]
        ]
      ]
    };
    const ring = lShape.coordinates[0]!;
    expect(insideRing([-75.571, 6.358], ring)).toBe(false);

    expect(insideRing(territoryLabelPoint(lShape), ring)).toBe(true);
  });
});

describe('territoryLabelPoint (multi-part territories)', () => {
  it('puts the single label inside the LARGEST part, whatever the part order', () => {
    const small: Polygon = {
      type: 'Polygon',
      coordinates: [[[-75.58, 6.35], [-75.579, 6.35], [-75.579, 6.351], [-75.58, 6.351], [-75.58, 6.35]]]
    };
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [small.coordinates, SQUARE.coordinates] };

    const point = territoryLabelPoint(multi);

    expect(insideRing(point, SQUARE.coordinates[0]!)).toBe(true);
    expect(insideRing(point, small.coordinates[0]!)).toBe(false);
  });
});

describe('territoryStartPoint', () => {
  it('is the label point of the largest part, as a lat/lon destination for directions', () => {
    const [lon, lat] = territoryLabelPoint(SQUARE);
    expect(territoryStartPoint(SQUARE)).toEqual({ lat, lon });
  });
});

describe('createTerritoryLabelElement', () => {
  it('shows the territory name as plain text, never as HTML', () => {
    const element = createTerritoryLabelElement('Nv-01 <img src=x onerror=alert(1)>');

    expect(element.className).toBe('territory-label');
    expect(element.textContent).toBe('Nv-01 <img src=x onerror=alert(1)>');
    expect(element.querySelector('img')).toBeNull();
  });
});
