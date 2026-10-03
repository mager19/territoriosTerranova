import { describe, expect, it } from 'vitest';

import { computeBoundingBox, directionsUrl, haversineMeters } from './map.js';

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

describe('computeBoundingBox (multi-part territories)', () => {
  it('spans every part of a MultiPolygon', () => {
    const box = computeBoundingBox({
      type: 'MultiPolygon',
      coordinates: [
        [[[-75.574, 6.357], [-75.572, 6.357], [-75.572, 6.359], [-75.574, 6.357]]],
        [[[-75.565, 6.35], [-75.563, 6.35], [-75.563, 6.352], [-75.565, 6.35]]]
      ]
    });
    expect(box).toEqual({ west: -75.574, east: -75.563, south: 6.35, north: 6.359 });
  });
});

describe('directionsUrl', () => {
  it('builds a Google Maps walking-directions link to the given point', () => {
    const url = directionsUrl({ lat: 6.358, lon: -75.573 });

    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=6.358,-75.573&travelmode=walking');
  });
});

describe('haversineMeters', () => {
  it('returns zero for the same point', () => {
    expect(haversineMeters({ lat: 6.358, lon: -75.573 }, { lat: 6.358, lon: -75.573 })).toBe(0);
  });

  it('returns a plausible distance for two nearby points (~230 m apart)', () => {
    // One block of latitude, roughly: 0.002 degrees ~ 222 m.
    const distance = haversineMeters({ lat: 6.357, lon: -75.573 }, { lat: 6.359, lon: -75.573 });

    expect(distance).toBeGreaterThan(200);
    expect(distance).toBeLessThan(260);
  });
});
