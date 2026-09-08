/**
 * MapLibre rendering glue — display-only, no drawing. Basemap config
 * verified against the live service and reused from
 * docs/map-references.md (same values as the admin app). OSM's public
 * tile server is rate-limited and NOT approved for production traffic —
 * fine for development only (docs/agents/README.md "Still open").
 *
 * Kept thin on purpose: everything here that touches a real MapLibre Map
 * instance needs WebGL and is not exercised in unit tests (the same
 * separation A5 kept between draft.ts and map-editor.ts). computeBoundingBox
 * below is the one piece of real logic in this file, and it is pure, so it
 * IS unit-tested (map.test.ts).
 */

import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, Polygon, Position } from '@territorios/geo';

export const BELLO_CENTER: [number, number] = [-75.5636, 6.3373];
export const BELLO_ZOOM = 13;
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export function createBelloMapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      'osm-raster': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: OSM_ATTRIBUTION
      }
    },
    layers: [{ id: 'osm-raster-layer', type: 'raster', source: 'osm-raster' }]
  };
}

export interface BoundingBox {
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
}

/** Pure WGS84 bounding-box math over a polygon's positions — no map instance needed. */
export function computeBoundingBox(geometry: Polygon): BoundingBox {
  const positions: readonly Position[] = geometry.coordinates.flat();
  const first = positions[0];
  if (!first) {
    throw new Error('cannot compute a bounding box for an empty polygon');
  }

  let west = first[0];
  let east = first[0];
  let south = first[1];
  let north = first[1];
  for (const [lon, lat] of positions) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, east, south, north };
}

function emptyFeatureCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/**
 * Two GeoJSON sources/layer pairs, visually distinct: the persisted
 * territory boundary (teal) and the latest recorded remaining-area
 * estimate (dashed magenta) — never the same style, so a field worker
 * never confuses "the whole territory" with "what is left".
 */
export function installTerritoryLayers(map: MapLibreMap): void {
  map.addSource('territory-boundary', { type: 'geojson', data: emptyFeatureCollection() as GeoJSON.GeoJSON });
  map.addLayer({
    id: 'territory-boundary-fill',
    type: 'fill',
    source: 'territory-boundary',
    paint: { 'fill-color': '#2f6f5e', 'fill-opacity': 0.22 }
  });
  map.addLayer({
    id: 'territory-boundary-line',
    type: 'line',
    source: 'territory-boundary',
    paint: { 'line-color': '#143f35', 'line-width': 2 }
  });

  // Empty when remainingArea is null — this is the visual counterpart of
  // the "unknown" status text; it never renders a guessed shape (AGENTS.md:
  // coverage is never inferred).
  map.addSource('remaining-area', { type: 'geojson', data: emptyFeatureCollection() as GeoJSON.GeoJSON });
  map.addLayer({
    id: 'remaining-area-fill',
    type: 'fill',
    source: 'remaining-area',
    paint: { 'fill-color': '#b0339a', 'fill-opacity': 0.2 }
  });
  map.addLayer({
    id: 'remaining-area-line',
    type: 'line',
    source: 'remaining-area',
    paint: { 'line-color': '#7a1f6b', 'line-width': 2, 'line-dasharray': [1, 1] }
  });
}

function setSource(map: MapLibreMap, sourceId: string, geometry: Polygon | null): void {
  const source = map.getSource(sourceId);
  if (!source || !('setData' in source)) return;
  const feature: Feature = { type: 'Feature', properties: null, geometry };
  const data: FeatureCollection = geometry === null ? emptyFeatureCollection() : { type: 'FeatureCollection', features: [feature] };
  (source as { setData(data: GeoJSON.GeoJSON): void }).setData(data as unknown as GeoJSON.GeoJSON);
}

export function renderTerritory(map: MapLibreMap, boundary: Polygon, remainingArea: Polygon | null): void {
  setSource(map, 'territory-boundary', boundary);
  setSource(map, 'remaining-area', remainingArea);
}

export function fitToBoundingBox(map: MapLibreMap, box: BoundingBox): void {
  map.fitBounds(
    [
      [box.west, box.south],
      [box.east, box.north]
    ],
    { padding: 32, animate: false }
  );
}
