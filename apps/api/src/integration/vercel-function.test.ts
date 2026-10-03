/**
 * The Vercel Function end to end against real PostGIS (Testcontainers):
 * createServerlessApp() configured from environment variables exactly as on
 * Vercel, behind createVercelHandler(), served by a real Node HTTP server so
 * the handler gets genuine IncomingMessage/ServerResponse objects. Requests
 * use the /api paths the browser uses.
 */

import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '@territorios/geo/db/migrate';
import type { FastifyInstance } from 'fastify';

import { createServerlessApp, createVercelHandler } from '../vercel.js';

const IMAGE = 'postgis/postgis:16-3.4';
const ADMIN_ORIGIN = 'https://admin.example.test';
const PUBLIC_ORIGIN = 'https://public.example.test';
const EMAIL = 'admin@example.test';
const PASSWORD = 'function-test-password-0123';

let container: StartedPostgreSqlContainer;
let server: Server;
let base: string;
let app: FastifyInstance | undefined;

beforeAll(async () => {
  container = await new PostgreSqlContainer(IMAGE)
    .withDatabase('territorios_api_vercel_function_test')
    .withUsername('territorios')
    .withPassword('territorios')
    .withStartupTimeout(300_000)
    .start();
  await runMigrations(container.getConnectionUri());

  // The production environment of the admin Vercel project (docs/deploy-vercel.md).
  const env = {
    NODE_ENV: 'production',
    DATABASE_URL: container.getConnectionUri(),
    ADMIN_1_EMAIL: EMAIL,
    ADMIN_1_PASSWORD: PASSWORD,
    ADMIN_APP_ORIGIN: ADMIN_ORIGIN,
    PUBLIC_APP_ORIGIN: PUBLIC_ORIGIN,
    TRUST_PROXY: '1'
  };
  const handler = createVercelHandler(async () => {
    app = await createServerlessApp(env);
    return app;
  });
  server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await app?.close();
  await container?.stop();
});

describe('the API as a Vercel Function', () => {
  it('reports a healthy database under /api/health', async () => {
    const response = await fetch(`${base}/api/health`);

    expect(response.status).toBe(200);
    expect((await response.json()) as object).toMatchObject({ status: 'ok', database: { up: true } });
  });

  it('signs in, sets a Secure SameSite=Strict session cookie, and accepts it on the next /api request', async () => {
    const login = await fetch(`${base}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ADMIN_ORIGIN },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD })
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/admin_session=/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Strict/);

    const me = await fetch(`${base}/api/admin/me`, { headers: { cookie: setCookie.split(';')[0]! } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ email: EMAIL });
  });

  it('refuses admin routes without a session', async () => {
    const response = await fetch(`${base}/api/admin/territories`);
    expect(response.status).toBe(401);
  });

  it('serves the public share endpoint to the public app cross-origin, with its privacy headers', async () => {
    const response = await fetch(`${base}/api/public/territories/no-such-token`, {
      headers: { origin: PUBLIC_ORIGIN }
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBe(PUBLIC_ORIGIN);
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('routes the rewritten URL form (/api?__path=...) the same way', async () => {
    const response = await fetch(`${base}/api?__path=health`);
    expect(response.status).toBe(200);
  });
});

describe('apps/admin/api/index.js (the file Vercel deploys)', () => {
  it('exports the Node.js request handler as its default export', async () => {
    // The entry imports ./_api.mjs, the self-contained bundle Vercel ships;
    // build it from the current sources first (esbuild, well under a second).
    execFileSync('pnpm', ['--filter', '@territorios/admin', 'bundle:api'], { stdio: 'ignore' });
    const entryPath = '../../../admin/api/index.js'; // untyped JavaScript: keep it out of tsc
    const entry = (await import(entryPath)) as { default: unknown };
    expect(typeof entry.default).toBe('function');
  });
});
