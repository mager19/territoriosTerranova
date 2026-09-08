import { describe, expect, it } from 'vitest';

import { computeBoundingBox } from './map.js';

describe('computeBoundingBox', () => {
  it('computes the WGS84 bounding box of a polygon', () => {
    const box = computeBoundingBox({
      type: 'Polygon',
      coordinates: [
        [
          [-75.574, 6.357],
          [-75.572, 6.357],
          [-75.572, 6.359],
          [-75.574, 6.359],
          [-75.574, 6.357]
        ]
      ]
    });

    expect(box).toEqual({ west: -75.574, east: -75.572, south: 6.357, north: 6.359 });
  });

  it('throws for an empty polygon rather than returning a meaningless box', () => {
    expect(() => computeBoundingBox({ type: 'Polygon', coordinates: [] })).toThrow();
  });
});
