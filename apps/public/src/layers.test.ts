import { describe, expect, it } from 'vitest';
import type { Polygon } from '@territorios/geo';

import { createPausePointMarkerElement, hasDrawableArea, LAYER_COLORS, legendItems, PAUSE_POINT_LABEL } from './layers.js';

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
    const items = legendItems({ coveredArea: SQUARE, remainingArea: SQUARE, route: null, pausePoint: null });

    expect(items.map((item) => [item.label, item.color])).toEqual([
      ['Hecho', LAYER_COLORS.covered],
      ['Pendiente', LAYER_COLORS.remaining]
    ]);
    expect(LAYER_COLORS.covered).not.toBe(LAYER_COLORS.remaining);
  });

  it('omits an empty covered area — nothing done yet has nothing to explain', () => {
    const items = legendItems({ coveredArea: EMPTY, remainingArea: null, route: null, pausePoint: null });

    expect(items).toEqual([]);
  });

  it('shows the pause point as a point entry labeled "Aquí quedamos"', () => {
    const items = legendItems({
      coveredArea: null,
      remainingArea: null,
      route: null,
      pausePoint: { type: 'Point', coordinates: [-75.573, 6.358] }
    });

    expect(items).toEqual([{ key: 'pausePoint', label: PAUSE_POINT_LABEL, color: LAYER_COLORS.pausePoint, shape: 'point' }]);
    expect(PAUSE_POINT_LABEL).toBe('Aquí quedamos');
  });
});

describe('createPausePointMarkerElement', () => {
  it('builds a labeled, accessible marker that always shows "Aquí quedamos"', () => {
    const marker = createPausePointMarkerElement();

    expect(marker.textContent).toBe('Aquí quedamos');
    expect(marker.getAttribute('role')).toBe('img');
    expect(marker.getAttribute('aria-label')).toBe('Aquí quedamos');
    expect(marker.querySelector('.pause-point-dot')).not.toBeNull();
  });
});
