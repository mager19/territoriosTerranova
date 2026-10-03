import { describe, expect, it } from 'vitest';

import type { MultiPolygon, Polygon } from '@territorios/geo';

import { geometryToThumbnail, polygonToThumbnail } from './thumbnail.js';

function bounds(points: string): { minX: number; maxX: number; minY: number; maxY: number } {
  const coords = points.split(' ').map((pair) => pair.split(',').map(Number));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

const square: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0]
    ]
  ]
};

const offCenter: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [10, 20],
      [18, 20],
      [18, 24],
      [10, 24],
      [10, 20]
    ]
  ]
};

const withHole: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0]
    ],
    [
      [0.5, 0.5],
      [1.5, 0.5],
      [1.5, 1.5],
      [0.5, 1.5],
      [0.5, 0.5]
    ]
  ]
};

describe('polygonToThumbnail', () => {
  it('maps a simple square to the full padded viewBox, centered and aspect-preserved', () => {
    const { viewBox, points } = polygonToThumbnail(square);

    expect(viewBox).toBe('0 0 120 120');
    // 120×120 viewBox with an 8px inset → the shape spans 8..112 on both axes.
    expect(points).toBe('8,112 112,112 112,8 8,8 8,112');

    const b = bounds(points);
    expect(b.minX).toBe(8);
    expect(b.maxX).toBe(112);
    expect(b.minY).toBe(8);
    expect(b.maxY).toBe(112);
    expect((b.minX + b.maxX) / 2).toBe(60);
    expect((b.minY + b.maxY) / 2).toBe(60);
  });

  it('draws only the outer ring, ignoring holes', () => {
    expect(polygonToThumbnail(withHole).points).toBe(polygonToThumbnail(square).points);
  });

  it('translates an off-center polygon so it is centered and never clipped', () => {
    const { viewBox, points } = polygonToThumbnail(offCenter);

    expect(viewBox).toBe('0 0 120 120');

    const b = bounds(points);
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(120);
    expect(b.minY).toBeGreaterThanOrEqual(0);
    expect(b.maxY).toBeLessThanOrEqual(120);

    // The wider axis fills the padded width; the shorter axis stays centered.
    expect(b.minX).toBe(8);
    expect(b.maxX).toBe(112);
    expect((b.minY + b.maxY) / 2).toBe(60);
  });

  it('is deterministic for the same input', () => {
    expect(polygonToThumbnail(square)).toEqual(polygonToThumbnail(square));
  });
});

describe('geometryToThumbnail (multi-part territories)', () => {
  it('draws a Polygon exactly like polygonToThumbnail', () => {
    expect(geometryToThumbnail(square).parts).toEqual([polygonToThumbnail(square).points]);
  });

  it('draws every part of a MultiPolygon in one shared viewBox, keeping the gap between them', () => {
    // Two 2x2 squares side by side with a 2-unit gap: total span 6 x 2.
    const twoParts: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        square.coordinates,
        [[[4, 0], [6, 0], [6, 2], [4, 2], [4, 0]]]
      ]
    };
    const { viewBox, parts } = geometryToThumbnail(twoParts);
    expect(viewBox).toBe('0 0 120 120');
    expect(parts).toHaveLength(2);

    const left = bounds(parts[0]!);
    const right = bounds(parts[1]!);
    // The wider axis (6 units) fills 8..112; each square spans a third of it.
    expect(left.minX).toBe(8);
    expect(right.maxX).toBe(112);
    expect(right.minX - left.maxX).toBeCloseTo(104 / 3, 6);
    expect(left.minY).toBe(right.minY);
  });
});
