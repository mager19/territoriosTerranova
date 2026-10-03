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
import type { Feature, FeatureCollection, Geometry, Position, TerritoryGeometry } from '@territorios/geo';

import { hasDrawableArea, LAYER_COLORS } from './layers.js';
import type { PublicTerritoryView } from './public-api.js';

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

/** Pure WGS84 bounding-box math over every part's positions — no map instance needed. */
export function computeBoundingBox(geometry: TerritoryGeometry): BoundingBox {
  const positions: readonly Position[] =
    geometry.type === 'Polygon' ? geometry.coordinates.flat() : geometry.coordinates.flat(2);
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

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/**
 * A plain "get directions" deep link — not an API integration. The
 * browser/OS decides what opens it (the installed Google Maps app, or its
 * web fallback); this app has no dependency on Google beyond this one
 * outbound URL, the same category as a `mailto:` or `tel:` link. Chosen
 * over a `geo:` URI because `geo:` has no reliable handler on iOS Safari —
 * this format works cross-platform without guessing which maps app (if
 * any) is installed.
 */
export function directionsUrl(destination: LatLon): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lon}&travelmode=walking`;
}

const EARTH_RADIUS_METERS = 6371000;

/** Great-circle distance in meters — good enough at block/city scale, no need for an ellipsoidal model here. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

function emptyFeatureCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/**
 * A territory is a block (manzana): its boundary edges ARE the houses —
 * the streets a field worker walks door to door. Progress is therefore a
 * property of the PERIMETER, not an interior area: two layers, not three.
 *
 * - territory-boundary: the whole block outline, neutral gray and dashed
 *   — "this is the block, undifferentiated" (the plain baseline in the
 *   worker's own reference sketch).
 * - progress-route: a bold, near-black line drawn on top of exactly the
 *   stretch of that perimeter already covered. Where the boundary shows
 *   through gray and dashed underneath, that side is not done yet — there
 *   is no separate "remaining" shape to draw or keep in sync.
 *
 * remaining-area (a filled interior polygon) stays supported in the data
 * model and this file (A3's domain, A4's contract) for a genuinely
 * different case — open ground that isn't a walkable perimeter — but is
 * deliberately understated here so it never visually competes with the
 * route line for the common manzana case.
 */
export function installTerritoryLayers(map: MapLibreMap): void {
  map.addSource('territory-boundary', { type: 'geojson', data: emptyFeatureCollection() as GeoJSON.GeoJSON });
  // A light purple tint, not gray — a placeholder for the future
  // staleness-by-color scheme (docs/agents/README.md "Deferred product
  // scope": color will eventually encode how long a territory has gone
  // unworked). Today it is purely decorative and carries no meaning.
  map.addLayer({
    id: 'territory-boundary-fill',
    type: 'fill',
    source: 'territory-boundary',
    paint: { 'fill-color': '#8e5ec9', 'fill-opacity': 0.22 }
  });
  map.addLayer({
    id: 'territory-boundary-line',
    type: 'line',
    source: 'territory-boundary',
    // Solid, dark and 3 px: a faint grey dashed edge was hard to tell apart
    // from the grey OSM basemap on a phone outdoors (2026-10-03).
    paint: { 'line-color': '#5b3a8a', 'line-width': 3 }
  });

  // The area already done in the current cycle (2026-09-26 product
  // decision): ONE server-merged shape, a muted green fill drawn under the
  // remaining area and the route so "done" never hides what is pending.
  // Empty when nothing was covered.
  map.addSource('covered-area', { type: 'geojson', data: emptyFeatureCollection() as GeoJSON.GeoJSON });
  map.addLayer({
    id: 'covered-area-fill',
    type: 'fill',
    source: 'covered-area',
    paint: { 'fill-color': LAYER_COLORS.covered, 'fill-opacity': 0.4 }
  });

  // Understated on purpose (see doc comment above) — only meaningful when
  // progress is genuinely area-shaped rather than perimeter-shaped. Empty
  // when remainingArea is null; that is the visual counterpart of the
  // "unknown" status text, it never renders a guessed shape (AGENTS.md:
  // coverage is never inferred).
  map.addSource('remaining-area', { type: 'geojson', data: emptyFeatureCollection() as GeoJSON.GeoJSON });
  map.addLayer({
    id: 'remaining-area-fill',
    type: 'fill',
    source: 'remaining-area',
    paint: { 'fill-color': LAYER_COLORS.remaining, 'fill-opacity': 0.35 }
  });

  // The actual progress line — bold and near-black, the darkest element
  // on the map, deliberately (2026-09-08 product decision, AGENTS.md
  // "Privacy rules"): this is what a field worker actually walked, so
  // far, drawn last so it always sits on top of the plain gray boundary.
  // Absent (no progress entry recorded a route) means this layer stays
  // empty, same "never a guessed shape" rule as remaining-area.
  map.addSource('progress-route', { type: 'geojson', data: emptyFeatureCollection() as GeoJSON.GeoJSON });
  map.addLayer({
    id: 'progress-route-line',
    type: 'line',
    source: 'progress-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': LAYER_COLORS.route, 'line-width': 4 }
  });
}

function setSource(map: MapLibreMap, sourceId: string, geometry: Geometry | null): void {
  const source = map.getSource(sourceId);
  if (!source || !('setData' in source)) return;
  const feature: Feature = { type: 'Feature', properties: null, geometry };
  const data: FeatureCollection = geometry === null ? emptyFeatureCollection() : { type: 'FeatureCollection', features: [feature] };
  (source as { setData(data: GeoJSON.GeoJSON): void }).setData(data as unknown as GeoJSON.GeoJSON);
}

export type RenderableView = Pick<PublicTerritoryView, 'boundary' | 'coveredArea' | 'remainingArea' | 'route'>;

export function renderTerritory(map: MapLibreMap, view: RenderableView): void {
  setSource(map, 'territory-boundary', view.boundary);
  // An explicit empty polygon ("nothing left" / "nothing done") has nothing to draw.
  setSource(map, 'covered-area', hasDrawableArea(view.coveredArea) ? view.coveredArea : null);
  setSource(map, 'remaining-area', hasDrawableArea(view.remainingArea) ? view.remainingArea : null);
  setSource(map, 'progress-route', view.route);
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
