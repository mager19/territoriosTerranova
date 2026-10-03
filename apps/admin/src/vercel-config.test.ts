/**
 * Guards apps/admin/vercel.json, which serves the SPA and the API Function
 * from one origin (docs/deploy-vercel.md). Vercel matches rewrite sources as
 * regular expressions; these tests evaluate them the same way.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface Rewrite {
  readonly source: string;
  readonly destination: string;
}

const ADMIN_ROOT = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(readFileSync(`${ADMIN_ROOT}vercel.json`, 'utf8')) as {
  readonly installCommand: string;
  readonly buildCommand: string;
  readonly regions: readonly string[];
  readonly functions: Record<string, { readonly maxDuration: number }>;
  readonly rewrites: readonly Rewrite[];
};

/** The destination of the first rewrite whose source matches `path`, like Vercel's router. */
function route(path: string): string | undefined {
  for (const { source, destination } of config.rewrites) {
    const match = new RegExp(`^${source}$`).exec(path);
    if (match) return destination.replace(/\$(\d)/g, (_, group: string) => match[Number(group)] ?? '');
  }
  return undefined;
}

describe('apps/admin/vercel.json', () => {
  it('sends every /api/* request to the API Function, carrying the original path', () => {
    expect(route('/api/admin/me')).toBe('/api?__path=admin/me');
    expect(route('/api/public/territories/tok-abc')).toBe('/api?__path=public/territories/tok-abc');
  });

  it('serves the SPA for client-side routes, but never for /api', () => {
    expect(route('/')).toBe('/index.html');
    expect(route('/territories/12')).toBe('/index.html');
    expect(route('/apiary')).toBe('/index.html');
    expect(route('/api')).toBeUndefined(); // the function itself answers /api
  });

  it('configures the function file that exists, with a bounded duration', () => {
    expect(Object.keys(config.functions)).toEqual(['api/index.js']);
    expect(existsSync(`${ADMIN_ROOT}api/index.js`)).toBe(true);
    expect(config.functions['api/index.js']!.maxDuration).toBeLessThanOrEqual(60);
  });

  it('builds the API bundle the function imports during install, before the function is packaged', () => {
    // Pinned here rather than in the dashboard: the first deploys ran the
    // dashboard's old commands, never built api/_api.mjs, and every /api
    // request failed with ERR_MODULE_NOT_FOUND.
    expect(config.installCommand).toMatch(/^pnpm install && /);
    expect(config.installCommand).toContain('pnpm --filter @territorios/geo build');
    expect(config.installCommand).toMatch(/pnpm --filter @territorios\/admin bundle:api$/);
    expect(config.buildCommand).toBe('vite build');
    expect(readFileSync(`${ADMIN_ROOT}api/index.js`, 'utf8')).toContain("from './_api.mjs'");
  });

  it('runs the function next to the Neon database (us-east-2, Ohio)', () => {
    expect(config.regions).toEqual(['cle1']);
  });
});
