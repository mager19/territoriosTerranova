import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  // maplibre-gl loads its tile-processing Web Worker as a separate chunk at
  // runtime. Vite's esbuild-based dep pre-bundler does not follow that
  // dynamic worker reference, so it never gets pre-bundled — the dev
  // server then 404s on it (observed: "maplibre-gl-worker.mjs ... which is
  // in the optimize deps directory"). Symptom: raster tiles render fine
  // (plain images, no worker needed) while EVERY GeoJSON-sourced layer
  // (the draft being drawn, the saved territory boundary) silently never
  // renders, because the worker that turns GeoJSON into paintable tiles
  // never loaded. Excluding maplibre-gl from pre-bundling makes Vite serve
  // it (and its worker) as real ES modules instead.
  optimizeDeps: {
    exclude: ['maplibre-gl']
  }
});
