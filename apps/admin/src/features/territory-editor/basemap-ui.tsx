/**
 * Basemap glue for the admin maps: applies the selected style to a
 * MapLibre map, adds the MapTiler logo control, renders the text
 * attribution line under each map, and offers the "Calles" /
 * "Construcciones" switch on the drawing maps. Selection logic itself is
 * pure and lives in basemap.ts.
 *
 * OSM is the default everywhere. MapTiler Streets v2 (building footprints
 * OSM lacks in parts of Bello) is only an admin opt-in, offered when
 * VITE_MAPTILER_KEY is set and remembered per browser
 * (basemap-preference.ts).
 */

import { useCallback, useRef, useState, type JSX, type RefObject } from 'react';
import type { IControl, Map as MapLibreMap } from 'maplibre-gl';

import {
  MAPTILER_COPYRIGHT_URL,
  MAPTILER_HOME_URL,
  MAPTILER_LOGO_URL,
  OSM_COPYRIGHT_URL,
  createOsmBasemap,
  hasMapTilerKey,
  selectBasemap,
  type Basemap,
  type BasemapKind
} from './basemap.js';
import { readBasemapPreference, writeBasemapPreference } from './basemap-preference.js';
import { OSM_ATTRIBUTION } from './map-editor.js';

/** Overview thumbnails and previews: always OSM, no switch. */
export const PREVIEW_BASEMAP: Basemap = createOsmBasemap();

/** Read at call time (not module load) so tests can stub the env per case. */
function readMapTilerKey(): string | undefined {
  return import.meta.env.VITE_MAPTILER_KEY;
}

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
 * transformStyle; 'load' still fires once for either basemap. Returns the
 * MapTiler logo control it added, or null.
 */
export function applyBasemap(map: MapLibreMap, basemap: Basemap): IControl | null {
  if (basemap.kind === 'maptiler') {
    map.setStyle(basemap.style, { transformStyle: basemap.transformStyle });
    const logo = createMapTilerLogoControl();
    map.addControl(logo, 'bottom-left');
    return logo;
  }
  map.setStyle(basemap.style);
  return null;
}

/**
 * Replaces the style of a map that has already loaded. `diff: false`
 * forces a full style reload, so 'style.load' always fires afterwards —
 * the caller re-installs and re-renders its own layers then (a full
 * reload drops every app source/layer). Returns the new logo control.
 */
export function swapBasemap(map: MapLibreMap, basemap: Basemap, currentLogo: IControl | null): IControl | null {
  if (currentLogo !== null) {
    map.removeControl(currentLogo);
  }
  if (basemap.kind === 'maptiler') {
    map.setStyle(basemap.style, { diff: false, transformStyle: basemap.transformStyle });
    const logo = createMapTilerLogoControl();
    map.addControl(logo, 'bottom-left');
    return logo;
  }
  map.setStyle(basemap.style, { diff: false });
  return null;
}

export interface BasemapSwitch {
  /** The basemap currently shown (drives the attribution line and the pressed button). */
  readonly kind: BasemapKind;
  /** True only when a MapTiler key is configured; otherwise there is nothing to switch to. */
  readonly switchable: boolean;
  /**
   * Bumped after each switched style has loaded and the app layers were
   * re-installed: effects that render app data list it as a dependency so
   * they re-render the current state into the fresh, empty sources.
   */
  readonly styleRevision: number;
  /** Sets the initial style on a freshly constructed map. */
  readonly apply: (map: MapLibreMap) => void;
  readonly select: (kind: BasemapKind) => void;
}

/**
 * Per-map basemap state. `reinstallLayers` must add every app source and
 * layer the map's 'load' handler adds; it runs on 'style.load' after a
 * switch. Only call `select` once the map has loaded (the switcher is
 * disabled until then), so 'load' and 'style.load' never both install.
 */
export function useBasemapSwitch(
  mapRef: RefObject<MapLibreMap | null>,
  reinstallLayers: (map: MapLibreMap) => void
): BasemapSwitch {
  const [maptilerKey] = useState(readMapTilerKey);
  const switchable = hasMapTilerKey(maptilerKey);
  const [kind, setKind] = useState<BasemapKind>(() => (switchable ? readBasemapPreference() : 'osm'));
  const [styleRevision, setStyleRevision] = useState(0);
  const kindRef = useRef(kind);
  const logoRef = useRef<IControl | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const reinstallRef = useRef(reinstallLayers);
  reinstallRef.current = reinstallLayers;

  const apply = useCallback(
    (map: MapLibreMap) => {
      logoRef.current = applyBasemap(map, selectBasemap(maptilerKey, kindRef.current));
    },
    [maptilerKey]
  );

  const select = useCallback(
    (next: BasemapKind) => {
      if (!switchable || next === kindRef.current) return;
      kindRef.current = next;
      setKind(next);
      writeBasemapPreference(next);
      const map = mapRef.current;
      if (!map) return;
      // A quick second switch supersedes a style still loading: only the
      // latest style's 'style.load' may re-install the layers (twice would
      // throw on the duplicate source ids).
      if (pendingRef.current !== null) {
        map.off('style.load', pendingRef.current);
      }
      const onStyleLoad = (): void => {
        map.off('style.load', onStyleLoad);
        pendingRef.current = null;
        reinstallRef.current(map);
        setStyleRevision((revision) => revision + 1);
      };
      pendingRef.current = onStyleLoad;
      map.on('style.load', onStyleLoad);
      logoRef.current = swapBasemap(map, selectBasemap(maptilerKey, next), logoRef.current);
    },
    [mapRef, maptilerKey, switchable]
  );

  return { kind, switchable, styleRevision, apply, select };
}

const SWITCH_OPTIONS: readonly { readonly kind: BasemapKind; readonly label: string; readonly title: string }[] = [
  { kind: 'osm', label: 'Calles', title: 'Calles (OpenStreetMap)' },
  { kind: 'maptiler', label: 'Construcciones', title: 'Construcciones (MapTiler): muestra las edificaciones' }
];

/** Compact segmented control over the map's top-left corner; renders nothing without a MapTiler key. */
export function BasemapSwitcher({
  basemap,
  disabled = false
}: {
  readonly basemap: BasemapSwitch;
  readonly disabled?: boolean;
}): JSX.Element | null {
  if (!basemap.switchable) return null;
  return (
    <div className="basemap-switcher" role="group" aria-label="Mapa base">
      {SWITCH_OPTIONS.map((option) => (
        <button
          key={option.kind}
          type="button"
          title={option.title}
          aria-pressed={basemap.kind === option.kind}
          disabled={disabled}
          onClick={() => basemap.select(option.kind)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
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
