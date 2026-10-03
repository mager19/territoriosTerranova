import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // One repo-root .env / .env.local serves both apps (VITE_MAPTILER_KEY,
  // docs/map-references.md "Basemap"). Only VITE_-prefixed variables are
  // exposed to client code.
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Same-origin API (docs/admin-auth.md): /api/* goes to the local API with
    // the prefix stripped, so the httpOnly session cookie is first-party.
    // Production does the same with a Vercel rewrite (vercel.json).
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  // The MapLibre worker is bundled as an ES module (src/maplibre-worker.ts).
  worker: {
    format: 'es'
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
