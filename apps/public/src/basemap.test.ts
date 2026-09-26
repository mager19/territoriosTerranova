import { describe, expect, it } from 'vitest';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

import {
  MAPTILER_ATTRIBUTION_HTML,
  PEDESTRIAN_PATH_COLOR,
  PEDESTRIAN_PATH_WIDTH,
  isPedestrianPathLayer,
  reinforcePedestrianPaths,
  selectBasemap,
  withMapTilerAttribution
} from './basemap.js';

// The OSM raster style exactly as it was before MapTiler existed (tag
// pre-maptiler) — spelled out literally so a change to the fallback cannot
// hide behind a shared helper.
const PREVIOUS_OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'osm-raster': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors'
    }
  },
  layers: [{ id: 'osm-raster-layer', type: 'raster', source: 'osm-raster' }]
};

// Layer ids, filters and paint copied from the live MapTiler streets-v2
// style.json (fetched 2026-09-26; long width/color expressions trimmed
// where irrelevant to selection). No API key appears in these fixtures.
const DASHES = { stops: [[14, [1, 0.5]], [18, [1, 0.25]]] } as unknown as number[];
const PATH_WIDTH = { base: 1.2, stops: [[14, 0.5], [16, 1], [18, 2], [22, 5]] } as unknown as number;

const PATH: LayerSpecification = {
  id: 'Path',
  type: 'line',
  source: 'maptiler_planet',
  'source-layer': 'transportation',
  minzoom: 12,
  filter: ['all', ['==', '$type', 'LineString'], ['in', 'class', 'path', 'pedestrian'], ['!=', 'brunnel', 'tunnel']],
  paint: { 'line-color': 'hsl(0, 0%, 79%)', 'line-dasharray': DASHES, 'line-width': PATH_WIDTH }
};
const PATH_MINOR: LayerSpecification = {
  id: 'Path minor',
  type: 'line',
  source: 'maptiler_planet',
  'source-layer': 'transportation',
  minzoom: 12,
  filter: ['all', ['==', '$type', 'LineString'], ['in', 'class', 'path_pedestrian'], ['!=', 'brunnel', 'tunnel']],
  paint: { 'line-color': 'hsl(0, 0%, 79%)', 'line-dasharray': DASHES, 'line-width': PATH_WIDTH }
};
const FOOTWAY_TUNNEL: LayerSpecification = {
  id: 'Footway tunnel',
  type: 'line',
  source: 'maptiler_planet',
  'source-layer': 'transportation',
  minzoom: 12,
  filter: ['all', ['==', '$type', 'LineString'], ['in', 'class', 'path', 'pedestrian'], ['==', 'brunnel', 'tunnel']],
  paint: { 'line-color': 'hsl(0,0%,63%)', 'line-dasharray': DASHES, 'line-opacity': 0.4, 'line-width': PATH_WIDTH }
};
const PATH_OUTLINE: LayerSpecification = {
  id: 'Path outline',
  type: 'line',
  source: 'maptiler_planet',
  'source-layer': 'transportation',
  minzoom: 12,
  filter: ['all', ['==', '$type', 'LineString'], ['in', 'class', 'path', 'pedestrian'], ['!=', 'brunnel', 'tunnel']],
  paint: { 'line-color': 'hsl(0,0%,100%)' }
};
const FOOTWAY_TUNNEL_OUTLINE: LayerSpecification = {
  ...PATH_OUTLINE,
  id: 'Footway tunnel outline',
  filter: ['all', ['==', '$type', 'LineString'], ['in', 'class', 'path', 'pedestrian'], ['==', 'brunnel', 'tunnel']]
};
const MINOR_ROAD: LayerSpecification = {
  id: 'Minor road',
  type: 'line',
  source: 'maptiler_planet',
  'source-layer': 'transportation',
  minzoom: 4,
  filter: [
    'all',
    ['!=', 'brunnel', 'tunnel'],
    ['!in', 'class', 'aerialway', 'bridge', 'ferry', 'minor_construction', 'motorway', 'motorway_construction', 'path', 'path_construction', 'pier', 'primary', 'primary_construction', 'rail', 'secondary_construction', 'service_construction', 'tertiary_construction', 'track_construction', 'transit', 'trunk_construction']
  ],
  paint: { 'line-color': 'hsl(0,0%,100%)' }
};
const PEDESTRIAN_AREA: LayerSpecification = {
  id: 'Pedestrian',
  type: 'fill',
  source: 'maptiler_planet',
  'source-layer': 'transportation',
  filter: ['all', ['==', '$type', 'Polygon'], ['!has', 'brunnel'], ['!in', 'class', 'bridge', 'pier'], ['in', 'subclass', 'pedestrian', 'platform']],
  paint: { 'fill-color': 'hsl(43,100%,99%)', 'fill-opacity': 0.7 }
};
const ROAD_LABELS: LayerSpecification = {
  id: 'Road labels',
  type: 'symbol',
  source: 'maptiler_planet',
  'source-layer': 'transportation_name',
  minzoom: 8,
  filter: ['all', ['!in', 'subclass', 'gondola', 'cable_car'], ['!in', 'class', 'ferry', 'service']],
  layout: { 'text-field': '{name}' }
};

// Synthetic edge cases (not in streets-v2 today) guarding against a
// future style change recoloring roads.
const MIXED_ROADS_AND_PATHS: LayerSpecification = {
  id: 'Road network',
  type: 'line',
  source: 'maptiler_planet',
  'source-layer': 'transportation',
  filter: ['in', ['get', 'class'], ['literal', ['path', 'minor']]]
};
const STEPS_BY_EXPRESSION: LayerSpecification = {
  id: 'Steps',
  type: 'line',
  source: 'maptiler_planet',
  'source-layer': 'transportation',
  filter: ['match', ['get', 'subclass'], ['steps', 'footway'], true, false]
};
const WATERWAY: LayerSpecification = {
  id: 'River',
  type: 'line',
  source: 'maptiler_planet',
  'source-layer': 'waterway',
  filter: ['==', 'class', 'path']
};

function styleWith(layers: LayerSpecification[]): StyleSpecification {
  return {
    version: 8,
    sources: { maptiler_planet: { type: 'vector', url: 'https://api.maptiler.com/tiles/v3/tiles.json' } },
    layers
  };
}

describe('selectBasemap', () => {
  it('uses MapTiler Streets v2 when a key is present', () => {
    const basemap = selectBasemap('abc123');

    expect(basemap.kind).toBe('maptiler');
    expect(basemap.style).toBe('https://api.maptiler.com/maps/streets-v2/style.json?key=abc123');
  });

  it('trims and URL-encodes the key', () => {
    expect(selectBasemap('  a b&c ').style).toBe('https://api.maptiler.com/maps/streets-v2/style.json?key=a%20b%26c');
  });

  it.each([undefined, '', '   '])('falls back to the previous OSM raster style for key %j', (key) => {
    const basemap = selectBasemap(key);

    expect(basemap.kind).toBe('osm');
    expect(basemap.style).toEqual(PREVIOUS_OSM_STYLE);
  });

  it('transforms the fetched MapTiler style: reinforced paths and explicit attribution', () => {
    const basemap = selectBasemap('k');
    if (basemap.kind !== 'maptiler') throw new Error('expected maptiler');

    const result = basemap.transformStyle(undefined, styleWith([PATH, MINOR_ROAD]));

    expect(result.layers[0]).toMatchObject({ paint: { 'line-color': PEDESTRIAN_PATH_COLOR } });
    expect(result.layers[1]).toBe(MINOR_ROAD);
    expect(result.sources.maptiler_planet).toMatchObject({ attribution: MAPTILER_ATTRIBUTION_HTML });
  });
});

describe('isPedestrianPathLayer', () => {
  it.each([
    ['streets-v2 "Path" (class path/pedestrian)', PATH],
    ['streets-v2 "Path minor" (class path_pedestrian)', PATH_MINOR],
    ['streets-v2 "Footway tunnel"', FOOTWAY_TUNNEL],
    ['an expression filter on subclass steps/footway', STEPS_BY_EXPRESSION]
  ])('selects %s', (_label, layer) => {
    expect(isPedestrianPathLayer(layer)).toBe(true);
  });

  it.each([
    ['streets-v2 "Path outline" (casing)', PATH_OUTLINE],
    ['streets-v2 "Footway tunnel outline" (casing)', FOOTWAY_TUNNEL_OUTLINE],
    ['streets-v2 "Minor road" (negates path)', MINOR_ROAD],
    ['streets-v2 "Pedestrian" (fill area)', PEDESTRIAN_AREA],
    ['streets-v2 "Road labels" (symbol)', ROAD_LABELS],
    ['a filter mixing paths with road classes', MIXED_ROADS_AND_PATHS],
    ['a line layer outside the transportation source-layer', WATERWAY]
  ])('does not select %s', (_label, layer) => {
    expect(isPedestrianPathLayer(layer)).toBe(false);
  });
});

describe('reinforcePedestrianPaths', () => {
  it('darkens and widens pedestrian line layers with a zoom ramp, keeping dashes, opacity and filters', () => {
    const result = reinforcePedestrianPaths(styleWith([PATH, FOOTWAY_TUNNEL]));

    expect(result.layers[0]).toEqual({
      ...PATH,
      paint: { 'line-color': PEDESTRIAN_PATH_COLOR, 'line-dasharray': DASHES, 'line-width': PEDESTRIAN_PATH_WIDTH }
    });
    expect(result.layers[1]).toMatchObject({ paint: { 'line-color': PEDESTRIAN_PATH_COLOR, 'line-opacity': 0.4 } });
    expect(PEDESTRIAN_PATH_WIDTH).toEqual(['interpolate', ['linear'], ['zoom'], 15, 1, 19, 3]);
  });

  it('leaves labels, casings, areas and roads untouched (same references), keeps order, and does not mutate the input', () => {
    const input = styleWith([PEDESTRIAN_AREA, PATH_OUTLINE, PATH, PATH_MINOR, MINOR_ROAD, ROAD_LABELS]);
    const snapshot = structuredClone(input);

    const result = reinforcePedestrianPaths(input);

    expect(result.layers[0]).toBe(PEDESTRIAN_AREA);
    expect(result.layers[1]).toBe(PATH_OUTLINE);
    expect(result.layers[4]).toBe(MINOR_ROAD);
    expect(result.layers[5]).toBe(ROAD_LABELS);
    expect(result.layers.map((l) => l.id)).toEqual(['Pedestrian', 'Path outline', 'Path', 'Path minor', 'Minor road', 'Road labels']);
    expect(input).toEqual(snapshot);
  });

  it('returns the style unchanged when no pedestrian layer exists (OSM fallback, unknown styles)', () => {
    const osm = selectBasemap(undefined).style as StyleSpecification;
    const noPaths = styleWith([MINOR_ROAD, WATERWAY, ROAD_LABELS]);

    expect(reinforcePedestrianPaths(osm)).toBe(osm);
    expect(reinforcePedestrianPaths(noPaths)).toBe(noPaths);
    expect(() => reinforcePedestrianPaths({ version: 8, sources: {}, layers: [] })).not.toThrow();
  });
});

describe('withMapTilerAttribution', () => {
  it('sets the MapTiler + OSM attribution on tiled sources only', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {
        maptiler_planet: { type: 'vector', url: 'https://example.test/tiles.json' },
        overlay: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
      },
      layers: []
    };

    const result = withMapTilerAttribution(style);

    expect(result.sources.maptiler_planet).toEqual({
      type: 'vector',
      url: 'https://example.test/tiles.json',
      attribution: MAPTILER_ATTRIBUTION_HTML
    });
    expect(result.sources.overlay).toBe(style.sources.overlay);
    expect(style.sources.maptiler_planet).not.toHaveProperty('attribution');
  });

  it('links both copyright pages', () => {
    expect(MAPTILER_ATTRIBUTION_HTML).toContain('href="https://www.maptiler.com/copyright/"');
    expect(MAPTILER_ATTRIBUTION_HTML).toContain('href="https://www.openstreetmap.org/copyright"');
  });
});
