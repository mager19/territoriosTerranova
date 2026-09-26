/**
 * Basemap glue for the admin maps: applies the selected style to a
 * MapLibre map, adds the MapTiler logo control, and renders the text
 * attribution line under each map. Selection logic itself is pure and
 * lives in basemap.ts.
 */

import type { JSX } from 'react';
import type { IControl, Map as MapLibreMap } from 'maplibre-gl';

import {
  MAPTILER_COPYRIGHT_URL,
  MAPTILER_HOME_URL,
  MAPTILER_LOGO_URL,
  OSM_COPYRIGHT_URL,
  selectBasemap,
  type Basemap,
  type BasemapKind
} from './basemap.js';
import { OSM_ATTRIBUTION } from './map-editor.js';

/** MapTiler Streets v2 when VITE_MAPTILER_KEY is set, otherwise the OSM raster fallback. */
export const ADMIN_BASEMAP: Basemap = selectBasemap(import.meta.env.VITE_MAPTILER_KEY);

/**
 * The MapTiler free plan requires its logo on the map. A plain MapLibre
 * control (same slot as MapLibre's own logo) linking to maptiler.com.
 */
export function createMapTilerLogoControl(doc: Document = document): IControl {
  const container = doc.createElement('div');
  container.className = 'maplibregl-ctrl maptiler-logo-ctrl';
  const link = doc.createElement('a');
  link.href = MAPTILER_HOME_URL;
  link.target = '_blank';
  link.rel = 'noopener';
  const logo = doc.createElement('img');
  logo.src = MAPTILER_LOGO_URL;
  logo.alt = 'MapTiler logo';
  logo.height = 21;
  link.append(logo);
  container.append(link);
  return {
    onAdd: () => container,
    onRemove: () => container.remove()
  };
}

/**
 * Sets the style right after construction (what the constructor's `style`
 * option does internally) so the MapTiler style can go through
 * transformStyle; 'load' still fires once for either basemap.
 */
export function applyBasemap(map: MapLibreMap, basemap: Basemap): void {
  if (basemap.kind === 'maptiler') {
    map.setStyle(basemap.style, { transformStyle: basemap.transformStyle });
    map.addControl(createMapTilerLogoControl(), 'bottom-left');
  } else {
    map.setStyle(basemap.style);
  }
}

export function BasemapAttribution({ kind }: { readonly kind: BasemapKind }): JSX.Element {
  if (kind === 'osm') {
    return <p className="map-attribution">{OSM_ATTRIBUTION}</p>;
  }
  return (
    <p className="map-attribution">
      <a href={MAPTILER_COPYRIGHT_URL} target="_blank" rel="noopener">
        © MapTiler
      </a>{' '}
      <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener">
        © OpenStreetMap contributors
      </a>
    </p>
  );
}
