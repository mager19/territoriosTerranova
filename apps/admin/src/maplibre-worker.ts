/**
 * Points MapLibre at a worker Vite actually ships.
 *
 * MapLibre 6 resolves its tile-processing worker next to its own module
 * (`new URL('./maplibre-gl-worker.mjs', import.meta.url)`). Once Vite bundles
 * MapLibre into `assets/index-*.js`, that resolves to
 * `/assets/maplibre-gl-worker.mjs`, a file the build never emits: in
 * production the SPA fallback answered it with index.html, the worker never
 * started, and every GeoJSON layer (draft, vertices, snap ring, territory)
 * silently stayed blank while raster tiles still drew. The dev server hid
 * this because it serves maplibre-gl straight from node_modules.
 *
 * `?worker&url` makes Vite bundle the worker together with the
 * `./maplibre-gl-shared.mjs` chunk it imports and returns the emitted URL.
 * Import this module before any map is created.
 */
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
