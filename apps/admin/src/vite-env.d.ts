/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * MapTiler API key. Set → the drawing maps offer a "Calles" / "Construcciones"
   * switch (OSM stays the default). Unset or empty → OSM only, no switch
   * (docs/map-references.md "Basemap").
   */
  readonly VITE_MAPTILER_KEY?: string;
}
