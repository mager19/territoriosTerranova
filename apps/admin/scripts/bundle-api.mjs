// Bundles the whole API (apps/api/src/vercel.ts and every dependency) into
// one self-contained ESM file, apps/admin/api/_api.mjs, for the Vercel
// Function (docs/deploy-vercel.md).
//
// Why a bundle: the function used to import `@territorios/api/vercel` by
// package name, which in this pnpm workspace is a node_modules symlink.
// Vercel's function packaging did not keep that symlink, so production
// failed with ERR_MODULE_NOT_FOUND. A single file imported by relative path
// needs no node_modules at runtime. The leading underscore keeps Vercel from
// treating it as a function of its own.
//
// Requires @territorios/geo to be built first (its package exports dist/).
import { build } from 'esbuild';
import path from 'node:path';

const adminRoot = path.join(import.meta.dirname, '..');

await build({
  absWorkingDir: adminRoot,
  entryPoints: ['../api/src/vercel.ts'],
  outfile: 'api/_api.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // pg optionally requires the native binding; it is never installed.
  external: ['pg-native'],
  // Bundled CommonJS dependencies (pg, fastify plugins) call require() for
  // Node built-ins, which ESM output does not provide on its own.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
  },
  logLevel: 'info'
});
