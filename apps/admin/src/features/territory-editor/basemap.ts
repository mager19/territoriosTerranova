/**
 * Basemap selection — pure, no map instance, no DOM (unit-tested in
 * basemap.test.ts). Kept in step with apps/public/src/basemap.ts;
 * the two apps deliberately do not share a runtime package for map glue
 * (same duplication as createBelloMapStyle in map-editor.ts).
 *
 * OSM raster (the style from map-editor.ts, untouched) is the default. MapTiler
 * Streets v2 (vector) is returned only when it is explicitly chosen AND a
 * MapTiler key is present; with no key every choice falls back to OSM
 * (docs/map-references.md "Basemap"). Only the admin app offers the choice;
 * the public volunteer view always uses OSM.
 */

import type { ExpressionSpecification, LayerSpecification, StyleSpecification, TransformStyleFunction } from 'maplibre-gl';

import { createBelloMapStyle } from './map-editor.js';

export const MAPTILER_STYLE_BASE_URL = 'https://api.maptiler.com/maps/streets-v2/style.json';
export const MAPTILER_COPYRIGHT_URL = 'https://www.maptiler.com/copyright/';
export const MAPTILER_HOME_URL = 'https://www.maptiler.com';
export const MAPTILER_LOGO_URL = 'https://api.maptiler.com/resources/logo.svg';
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

/** HTML attribution string MapLibre renders for MapTiler-sourced tiles (its attribution control accepts HTML). */
export const MAPTILER_ATTRIBUTION_HTML =
  `<a href="${MAPTILER_COPYRIGHT_URL}" target="_blank" rel="noopener">© MapTiler</a> ` +
  `<a href="${OSM_COPYRIGHT_URL}" target="_blank" rel="noopener">© OpenStreetMap contributors</a>`;

export type Basemap =
  | { readonly kind: 'osm'; readonly style: StyleSpecification }
  | { readonly kind: 'maptiler'; readonly style: string; readonly transformStyle: TransformStyleFunction };

export type BasemapKind = Basemap['kind'];

export function hasMapTilerKey(maptilerKey: string | undefined): boolean {
  return (maptilerKey?.trim() ?? '') !== '';
}

export function createOsmBasemap(): Basemap {
  return { kind: 'osm', style: createBelloMapStyle() };
}

export function createMapTilerBasemap(maptilerKey: string): Basemap {
  return {
    kind: 'maptiler',
    style: `${MAPTILER_STYLE_BASE_URL}?key=${encodeURIComponent(maptilerKey.trim())}`,
    transformStyle: (_previous, next) => withMapTilerAttribution(reinforcePedestrianPaths(next))
  };
}

/** OSM unless MapTiler is explicitly preferred and a key is present. */
export function selectBasemap(maptilerKey: string | undefined, preferred: BasemapKind = 'osm'): Basemap {
  if (preferred !== 'maptiler' || maptilerKey === undefined || !hasMapTilerKey(maptilerKey)) {
    return createOsmBasemap();
  }
  return createMapTilerBasemap(maptilerKey);
}

// --- Pedestrian path reinforcement -------------------------------------
//
// In Navarra/Niquía many walkable streets are OSM footways/steps, which
// Streets v2 draws as faint grey hairlines. OpenMapTiles puts them in the
// `transportation` source-layer with class `path` (subclasses footway,
// pedestrian, steps, path, ...); MapTiler adds `pedestrian` and
// `path_pedestrian` classes. A line layer is reinforced when its filter
// names at least one pedestrian value, names no road/rail class, and does
// not negate the pedestrian value. Casing/outline layers are left alone
// (they already add contrast under the line). Labels come from `symbol`
// layers on `transportation_name` and are never touched.
//
// Against the live streets-v2 style (checked 2026-09-26) this selects
// exactly `Path`, `Path minor` and `Footway tunnel`; it skips `Path
// outline`, `Footway tunnel outline`, the `Minor road` layers (which
// negate `path`) and the `Pedestrian` fill.

export const PEDESTRIAN_PATH_COLOR = '#6b4f36';
export const PEDESTRIAN_PATH_WIDTH: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 15, 1, 19, 3];

const PEDESTRIAN_VALUES = new Set(['path', 'path_pedestrian', 'path_construction', 'footway', 'pedestrian', 'steps']);
const NON_PEDESTRIAN_CLASSES = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'service',
  'raceway',
  'busway',
  'bus_guideway',
  'ferry',
  'rail',
  'transit',
  'motorway_construction',
  'trunk_construction',
  'primary_construction',
  'secondary_construction',
  'tertiary_construction',
  'minor_construction',
  'service_construction'
]);
const NEGATION_OPERATORS = new Set(['!', '!=', '!in', '!has', 'none']);
const CASING_ID = /casing|outline/i;

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  }
}

function negatesPedestrianValue(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const [operator, ...rest] = value as unknown[];
  if (typeof operator === 'string' && NEGATION_OPERATORS.has(operator)) {
    const strings: string[] = [];
    collectStrings(rest, strings);
    if (strings.some((s) => PEDESTRIAN_VALUES.has(s))) return true;
  }
  return rest.some(negatesPedestrianValue);
}

export function isPedestrianPathLayer(layer: LayerSpecification): boolean {
  if (layer.type !== 'line' || layer['source-layer'] !== 'transportation') return false;
  if (CASING_ID.test(layer.id)) return false;
  if (layer.filter === undefined) return false;

  const strings: string[] = [];
  collectStrings(layer.filter, strings);
  if (!strings.some((s) => PEDESTRIAN_VALUES.has(s))) return false;
  if (strings.some((s) => NON_PEDESTRIAN_CLASSES.has(s))) return false;
  return !negatesPedestrianValue(layer.filter);
}

/**
 * Returns a new style with pedestrian path line layers made darker and
 * wider. Dash pattern and opacity are kept (tunnel footways stay
 * translucent). Unchanged when no such layer exists.
 */
export function reinforcePedestrianPaths(style: StyleSpecification): StyleSpecification {
  if (!Array.isArray(style.layers) || !style.layers.some(isPedestrianPathLayer)) return style;
  return {
    ...style,
    layers: style.layers.map((layer) => {
      if (!isPedestrianPathLayer(layer) || layer.type !== 'line') return layer;
      return {
        ...layer,
        paint: {
          ...layer.paint,
          'line-color': PEDESTRIAN_PATH_COLOR,
          'line-width': PEDESTRIAN_PATH_WIDTH
        }
      };
    })
  };
}

/**
 * Sets our explicit attribution on every tiled source. MapLibre gives
 * explicit source options precedence over TileJSON, so the attribution
 * text is deterministic rather than whatever the TileJSON returns.
 */
export function withMapTilerAttribution(style: StyleSpecification): StyleSpecification {
  const sources: StyleSpecification['sources'] = {};
  for (const [id, source] of Object.entries(style.sources ?? {})) {
    const tiled = source.type === 'vector' || source.type === 'raster' || source.type === 'raster-dem';
    sources[id] = tiled ? { ...source, attribution: MAPTILER_ATTRIBUTION_HTML } : source;
  }
  return { ...style, sources };
}
