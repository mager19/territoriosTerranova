// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

interface Rewrite {
  readonly source: string;
  readonly destination: string;
}

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  rewrites?: readonly Rewrite[];
};

/** Vercel path-to-regexp sources here only use `(.*)`; enough to check what a rewrite would catch. */
function matches(source: string, pathname: string): boolean {
  const escape = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = source.split('(.*)').map(escape).join('(.*)');
  return new RegExp(`^${pattern}$`).test(pathname);
}

describe('apps/public/vercel.json', () => {
  const rewrites = config.rewrites ?? [];

  it('serves the single-page app for fixed /t/<slug> links', () => {
    const rewrite = rewrites.find((candidate) => matches(candidate.source, '/t/nv-01'));
    expect(rewrite?.destination).toBe('/index.html');
  });

  it.each(['/', '/assets/index-abc123.js', '/assets/maplibre-gl-worker-abc.js', '/index.html'])(
    'leaves %s to normal static serving',
    (pathname) => {
      expect(rewrites.some((candidate) => matches(candidate.source, pathname))).toBe(false);
    }
  );
});
