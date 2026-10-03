/**
 * The admin's last basemap choice, remembered per browser. Storage is a
 * convenience only: it may be missing or throw (private mode, blocked site
 * data), and every failure falls back to the OSM default.
 */

import type { BasemapKind } from './basemap.js';

export const BASEMAP_PREFERENCE_KEY = 'territorios.admin.basemap';

/** window.localStorage, or undefined where reading the accessor itself throws. */
export function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readBasemapPreference(storage: Storage | undefined = browserStorage()): BasemapKind {
  try {
    return storage?.getItem(BASEMAP_PREFERENCE_KEY) === 'maptiler' ? 'maptiler' : 'osm';
  } catch {
    return 'osm';
  }
}

export function writeBasemapPreference(kind: BasemapKind, storage: Storage | undefined = browserStorage()): void {
  try {
    storage?.setItem(BASEMAP_PREFERENCE_KEY, kind);
  } catch {
    // Not remembered this time; the choice still applies to the open map.
  }
}
