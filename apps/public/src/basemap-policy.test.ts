// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createOsmBasemap, selectBasemap } from './basemap.js';

const SOURCE_DIR = new URL('./', import.meta.url);

/** Every runtime source file of the public app (tests excluded). */
function runtimeSources(): { readonly name: string; readonly text: string }[] {
  return readdirSync(SOURCE_DIR)
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => ({ name, text: readFileSync(new URL(name, SOURCE_DIR), 'utf8') }));
}

// 2026-10-03: the MapTiler "Construcciones" basemap is an admin-only
// drafting aid. The public volunteer view always uses OSM, even if the
// public Vercel project ever had VITE_MAPTILER_KEY set by mistake.
describe('public basemap policy', () => {
  it('never reads a MapTiler key in runtime code', () => {
    const offenders = runtimeSources()
      .filter((source) => source.text.includes('VITE_MAPTILER_KEY'))
      .map((source) => source.name);

    expect(offenders).toEqual([]);
  });

  it('renders the map with the OSM basemap', () => {
    const main = readFileSync(new URL('main.ts', SOURCE_DIR), 'utf8');

    expect(main).toContain('createOsmBasemap()');
    expect(main).not.toContain('selectBasemap(');
    expect(createOsmBasemap().kind).toBe('osm');
  });

  it('defaults to OSM even when handed a key', () => {
    expect(selectBasemap('any-key').kind).toBe('osm');
  });
});
