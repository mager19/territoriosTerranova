import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // One repo-root .env / .env.local serves both apps (VITE_MAPTILER_KEY,
  // docs/map-references.md "Basemap"). Only VITE_-prefixed variables are
  // exposed to client code.
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  // Same fix as apps/admin/vite.config.ts: maplibre-gl loads its
  // tile-processing Web Worker as a separate chunk at runtime, which
  // Vite's esbuild dep pre-bundler does not follow, silently breaking
  // every GeoJSON-sourced layer. See that file's comment for the full
  // symptom description (found live during A5).
  optimizeDeps: {
    exclude: ['maplibre-gl']
  }
});
