/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** MapTiler API key. Unset or empty → OSM raster fallback basemap (docs/map-references.md "Basemap"). */
  readonly VITE_MAPTILER_KEY?: string;
}
