import { describe, expect, it } from 'vitest';
import type { Polygon } from '@territorios/geo';

import { hasDrawableArea, LAYER_COLORS, legendItems } from './layers.js';

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
