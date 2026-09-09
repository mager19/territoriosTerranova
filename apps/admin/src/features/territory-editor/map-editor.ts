/**
 * MapLibre rendering glue — thin on purpose (A5 brief: "the map is a
 * rendering surface, not the model"). All drawing state lives in draft.ts;
 * this module only turns MapLibre events into calls into that module and
 * renders its output as GeoJSON layers.
 *
 * Basemap config verified against the live service and reused verbatim
 * from docs/map-references.md. OSM's public tile server is rate-limited
 * and NOT approved for production traffic — fine for development only
 * (still an open production decision, docs/agents/README.md "Still open").
 *
 * GeoJSON types come from @territorios/geo — the project's one system of
 * record for this shape (AGENTS.md) — not a separate @types/geojson
 * dependency, so there is exactly one place these types can drift from
 * RFC 7946.
 */

import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from '@territorios/geo';

import type { Coordinate, DraftState } from './draft.js';

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

function emptyFeatureCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/** A GeoJSON source, structurally — maplibre-gl's own source union requires
 * an instanceof check to narrow to GeoJSONSource; this is deliberately
 * looser (any source that happens to have setData). */
interface GeoJsonLikeSource {
  setData(data: FeatureCollection): void;
}

function asGeoJsonSource(source: ReturnType<MapLibreMap['getSource']>): GeoJsonLikeSource | undefined {
  if (source && 'setData' in source && typeof (source as { setData?: unknown }).setData === 'function') {
    return source as unknown as GeoJsonLikeSource;
  }
  return undefined;
}

/** Screen pixel -> WGS84 [lon, lat] via MapLibre's real projection — never linear interpolation over a hardcoded extent (the archived attempt's bug). */
export function screenPointToCoordinate(map: MapLibreMap, point: { x: number; y: number }): Coordinate {
  const { lng, lat } = map.unproject([point.x, point.y]);
  return [lng, lat];
}

const VERTEX_HIT_RADIUS_PX = 8;

/**
 * Which draft vertex (if any) sits under a screen point, for drag-to-move.
 * Queries a small pixel bbox around the point rather than the exact pixel —
 * a single point rarely lands exactly on a 7px circle's rendered pixels,
 * on a mouse and especially on touch.
 */
export function findVertexIndexAtPoint(map: MapLibreMap, point: { x: number; y: number }): number | null {
  const features = map.queryRenderedFeatures(
    [
      [point.x - VERTEX_HIT_RADIUS_PX, point.y - VERTEX_HIT_RADIUS_PX],
      [point.x + VERTEX_HIT_RADIUS_PX, point.y + VERTEX_HIT_RADIUS_PX]
    ],
    { layers: ['draft-territory-vertices'] }
  );
  const index = features[0]?.properties?.index;
  return typeof index === 'number' ? index : null;
}

const EDGE_HIT_RADIUS_PX = 10;

/** Squared distance from a screen point to the segment [a, b] — squared throughout so no sqrt runs until the very end, once. */
function distanceToSegment(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  const closestX = a.x + t * dx;
  const closestY = a.y + t * dy;
  return Math.hypot(point.x - closestX, point.y - closestY);
}

/**
 * Which EDGE (if any) a screen point is near, for click-to-add: inserting a
 * new vertex belongs on the boundary/route itself, not in whatever empty
 * water/backyard the admin happened to click. Returns the index of the
 * vertex the edge starts at — draft.ts's insertVertex takes that same
 * "insert after this index" convention.
 *
 * `closed` (default true) controls whether the wraparound edge from the
 * last vertex back to the first is considered: true for a closed
 * territory ring (needs >= 3 vertices), false for an open route/LineString
 * (ProgressRecorder — needs only >= 2, and there is no "back to the
 * start" edge for a path that never closes).
 */
export function findEdgeIndexAtPoint(
  map: MapLibreMap,
  vertices: readonly Coordinate[],
  point: { x: number; y: number },
  closed: boolean = true
): number | null {
  const minVertices = closed ? 3 : 2;
  if (vertices.length < minVertices) return null;
  const projected = vertices.map((vertex) => map.project([vertex[0], vertex[1]]));
  const edgeCount = closed ? projected.length : projected.length - 1;
  let bestIndex: number | null = null;
  let bestDistance = EDGE_HIT_RADIUS_PX;
  for (let i = 0; i < edgeCount; i += 1) {
    const a = projected[i];
    const b = projected[(i + 1) % projected.length];
    if (!a || !b) continue;
    const distance = distanceToSegment(point, a, b);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Installs two GeoJSON sources/layer pairs, visually distinct on purpose:
 * "saved" (the persisted territory, from the server) in a muted, filled
 * style, and "draft" (the in-progress drawing) in an active accent color
 * with a dashed outline, so an administrator never confuses what they are
 * currently drawing with what is already saved.
 */
export function installEditorLayers(map: MapLibreMap): void {
  // Added first (bottom of the layer stack) so it never visually competes
  // with the saved/draft layers below — a thin dashed outline only, no
  // fill, since it is a real-world AMVA barrio boundary shown purely as a
  // drafting reference (2026-09-08: an admin expected one territory to
  // cover a whole barrio; a territory is one manzana/block by design, so
  // this lets them see the real barrio extent while drawing several).
  // Empty until installReferenceBarrios (App.tsx's search) sets it.
  map.addSource('reference-barrios', { type: 'geojson', data: emptyFeatureCollection() as GeoJSON.GeoJSON });
  map.addLayer({
    id: 'reference-barrios-line',
    type: 'line',
    source: 'reference-barrios',
    paint: { 'line-color': '#8a5a2e', 'line-width': 2, 'line-dasharray': [3, 2] }
  });

  map.addSource('saved-territory', { type: 'geojson', data: emptyFeatureCollection() as GeoJSON.GeoJSON });
  map.addLayer({
    id: 'saved-territory-fill',
    type: 'fill',
    source: 'saved-territory',
    paint: { 'fill-color': '#2f6f5e', 'fill-opacity': 0.22 }
  });
  map.addLayer({
    id: 'saved-territory-line',
    type: 'line',
    source: 'saved-territory',
    paint: { 'line-color': '#143f35', 'line-width': 2 }
  });

  // Remaining-area, from the latest progress entry — visually distinct from
  // both saved (teal) and draft (orange): a hatched magenta outline, since
  // it represents an ADMINISTRATOR-VIEWED estimate of what is left, never a
  // territory boundary or a drawing in progress. Absent (no progress entry
  // recorded a remaining area) means this layer simply stays empty — the UI
  // must say "unknown" in text elsewhere, never render a guessed shape.
  map.addSource('remaining-area', { type: 'geojson', data: emptyFeatureCollection() as GeoJSON.GeoJSON });
  map.addLayer({
    id: 'remaining-area-fill',
    type: 'fill',
    source: 'remaining-area',
    paint: { 'fill-color': '#b0339a', 'fill-opacity': 0.18 }
  });
  map.addLayer({
    id: 'remaining-area-line',
    type: 'line',
    source: 'remaining-area',
    paint: { 'line-color': '#7a1f6b', 'line-width': 2, 'line-dasharray': [1, 1] }
  });

  map.addSource('draft-territory', { type: 'geojson', data: emptyFeatureCollection() as GeoJSON.GeoJSON });
  map.addLayer({
    id: 'draft-territory-fill',
    type: 'fill',
    source: 'draft-territory',
    paint: { 'fill-color': '#e08a2e', 'fill-opacity': 0.3 }
  });
  map.addLayer({
    id: 'draft-territory-line',
    type: 'line',
    source: 'draft-territory',
    paint: { 'line-color': '#a85a12', 'line-width': 3, 'line-dasharray': [2, 2] }
  });
  map.addLayer({
    id: 'draft-territory-vertices',
    type: 'circle',
    source: 'draft-territory',
    filter: ['==', ['geometry-type'], 'Point'],
    // White halo + larger radius: a thin 5px dot in the project's teal/
    // orange palette was hard to pick out against busy OSM tiles at a
    // glance — this stays visible over any basemap color underneath it.
    paint: {
      'circle-radius': 7,
      'circle-color': '#e08a2e',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff'
    }
  });
}

/** `index` is carried as a feature property so findVertexIndexAtPoint below can identify which vertex a click/drag hit — the only reason any draft feature has properties at all. */
function pointFeature(coordinate: Coordinate, index: number): Feature {
  return { type: 'Feature', properties: { index }, geometry: { type: 'Point', coordinates: coordinate } };
}

/** Renders the current draft: vertex points always; a dashed line while open; a filled+outlined polygon once closed. */
export function renderDraft(map: MapLibreMap, draft: DraftState): void {
  const source = asGeoJsonSource(map.getSource('draft-territory'));
  if (!source) return;

  const features: Feature[] = draft.vertices.map((vertex, index) => pointFeature(vertex, index));

  if (draft.vertices.length >= 2) {
    const geometry: Geometry = draft.isClosed
      ? { type: 'Polygon', coordinates: [[...draft.vertices, draft.vertices[0]]] }
      : { type: 'LineString', coordinates: draft.vertices };
    features.push({ type: 'Feature', properties: null, geometry });
  }

  source.setData({ type: 'FeatureCollection', features });
}

/** Renders the persisted (server-confirmed) territory boundary, or clears it when there is none yet. */
export function renderSavedTerritory(map: MapLibreMap, geometry: Polygon | null): void {
  const source = asGeoJsonSource(map.getSource('saved-territory'));
  if (!source) return;
  source.setData(
    geometry === null
      ? { type: 'FeatureCollection', features: [] }
      : { type: 'FeatureCollection', features: [{ type: 'Feature', properties: null, geometry }] }
  );
}

export interface ReferenceBarrioFeatureInput {
  readonly name: string;
  readonly geometry: MultiPolygon;
}

/** Renders every barrio the search returned, or clears the layer for an empty/cleared search — same "empty means nothing to show" rule as the other overlay layers. */
export function renderReferenceBarrios(map: MapLibreMap, barrios: readonly ReferenceBarrioFeatureInput[]): void {
  const source = asGeoJsonSource(map.getSource('reference-barrios'));
  if (!source) return;
  const features: Feature[] = barrios.map((barrio) => ({
    type: 'Feature',
    properties: { name: barrio.name },
    geometry: barrio.geometry
  }));
  source.setData({ type: 'FeatureCollection', features });
}

/**
 * Renders the remaining-area geometry from the latest progress entry, or
 * clears the layer when there is none — an empty layer here is the visual
 * counterpart of the "unknown" status text; it never shows a guessed shape
 * (AGENTS.md: coverage is never inferred from a territory polygon).
 */
export function renderRemainingArea(map: MapLibreMap, geometry: Polygon | null): void {
  const source = asGeoJsonSource(map.getSource('remaining-area'));
  if (!source) return;
  source.setData(
    geometry === null
      ? { type: 'FeatureCollection', features: [] }
      : { type: 'FeatureCollection', features: [{ type: 'Feature', properties: null, geometry }] }
  );
}

/** Centers and fits the map to a polygon's bounding box, WGS84 in, WGS84 bounds out. */
export function fitToPolygon(map: MapLibreMap, geometry: Polygon): void {
  const positions: readonly Position[] = geometry.coordinates.flat();
  const first = positions[0];
  if (!first) return;

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
  map.fitBounds(
    [
      [west, south],
      [east, north]
    ],
    { padding: 48, animate: false }
  );
}

/** Same bbox-fit as fitToPolygon, one nesting level deeper for MultiPolygon's extra "which part" level. */
export function fitToMultiPolygon(map: MapLibreMap, geometry: MultiPolygon): void {
  const positions: readonly Position[] = geometry.coordinates.flat(2);
  const first = positions[0];
  if (!first) return;

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
  map.fitBounds(
    [
      [west, south],
      [east, north]
    ],
    { padding: 48, animate: false }
  );
}
