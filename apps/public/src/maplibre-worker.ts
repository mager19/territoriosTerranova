/**
 * URL of a MapLibre worker Vite actually ships.
 *
 * MapLibre 6 resolves its tile-processing worker next to its own module
 * (`new URL('./maplibre-gl-worker.mjs', import.meta.url)`). Once Vite bundles
 * MapLibre into a hashed chunk, that resolves to a file the build never
 * emits: in production the request got HTML back, the worker never started,
 * and every GeoJSON layer (territory, covered and remaining areas) silently
 * stayed blank while raster tiles still drew. The dev server hid this
 * because it serves maplibre-gl straight from node_modules.
 *
 * `?worker&url` makes Vite bundle the worker together with the
 * `./maplibre-gl-shared.mjs` chunk it imports and returns the emitted URL.
 * main.ts passes it to `setWorkerUrl` right after its lazy `import('maplibre-gl')`
 * (a static import here would pull MapLibre into the initial bundle).
 */
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

export const MAPLIBRE_WORKER_URL: string = workerUrl;
