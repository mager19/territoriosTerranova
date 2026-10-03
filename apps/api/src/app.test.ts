import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

import { buildApp } from './app.js';
import { testAuthConfig } from './test-support/admin-auth.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /health', () => {
  it('returns 200 with the PostGIS version when the database probe succeeds', async () => {
    app = await buildApp({ queryPostgisVersion: async () => '3.4.3' }, { logger: false });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      database: { up: true, postgisVersion: '3.4.3' }
    });
  });

  it('returns 503 and reports the database down when the probe fails', async () => {
    app = await buildApp(
      {
        queryPostgisVersion: async () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
        }
      },
      { logger: false }
    );

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable',
      database: { up: false }
    });
  });

  it('does not leak the driver error message in the 503 body', async () => {
    app = await buildApp(
      {
        queryPostgisVersion: async () => {
          throw new Error('password authentication failed for user "secret"');
        }
      },
      { logger: false }
    );

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.body;

    expect(response.statusCode).toBe(503);
    expect(body).not.toContain('password');
    expect(body).not.toContain('secret');
    expect(body).not.toContain('authentication');
  });
});

describe('client IP behind a proxy (TRUST_PROXY)', () => {
  async function clientIp(trustProxy: boolean | number, forwardedFor: string): Promise<string> {
    app = await buildApp({ queryPostgisVersion: async () => '3.4.3' }, { logger: false, trustProxy });
    app.get('/test-only/ip', async (request) => ({ ip: request.ip }));
    const response = await app.inject({ method: 'GET', url: '/test-only/ip', headers: { 'x-forwarded-for': forwardedFor } });
    return response.json<{ ip: string }>().ip;
  }

  it('takes the address the nearest proxy saw with a hop count of 1, ignoring anything a client prepended', async () => {
    expect(await clientIp(1, '203.0.113.10')).toBe('203.0.113.10');
    expect(await clientIp(1, '10.0.0.1, 203.0.113.10')).toBe('203.0.113.10');
  });

  it('ignores X-Forwarded-For entirely when no proxy is trusted', async () => {
    expect(await clientIp(false, '203.0.113.10')).toBe('127.0.0.1');
  });
});

describe('CORS', () => {
  const PUBLIC_ORIGIN = 'https://public.example.test';

  /** Every query answers "no rows": the public route then takes its 404 path. */
  const emptyPool = {
    connect: async () =>
      ({
        query: async () => ({ rows: [] }),
        release: () => undefined
      }) as unknown as PoolClient
  };

  async function buildCorsApp(): Promise<FastifyInstance> {
    return buildApp(
      { queryPostgisVersion: async () => '3.4.3', pool: emptyPool, auth: { config: testAuthConfig() } },
      { logger: false, publicAppOrigins: [PUBLIC_ORIGIN] }
    );
  }

  const PUBLIC_URLS = ['/public/territories/some-token', '/public/t/some-slug'];

  it.each(PUBLIC_URLS)('lets the configured public app read %s, without credentials', async (url) => {
    app = await buildCorsApp();

    const response = await app.inject({
      method: 'GET',
      url,
      headers: { origin: PUBLIC_ORIGIN }
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['access-control-allow-origin']).toBe(PUBLIC_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    // The privacy headers survive CORS.
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it.each(PUBLIC_URLS)('answers the %s preflight for the configured origin only', async (url) => {
    app = await buildCorsApp();

    const allowed = await app.inject({
      method: 'OPTIONS',
      url,
      headers: { origin: PUBLIC_ORIGIN, 'access-control-request-method': 'GET' }
    });
    expect(allowed.headers['access-control-allow-origin']).toBe(PUBLIC_ORIGIN);

    const other = await app.inject({
      method: 'OPTIONS',
      url,
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' }
    });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each(PUBLIC_URLS)('gives no CORS grant on %s to any other origin', async (url) => {
    app = await buildCorsApp();

    const response = await app.inject({
      method: 'GET',
      url,
      headers: { origin: 'https://evil.example' }
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each(['/health', '/admin/me', '/admin/territories'])('never grants the public origin access to %s', async (url) => {
    app = await buildCorsApp();

    const response = await app.inject({ method: 'GET', url, headers: { origin: PUBLIC_ORIGIN } });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('unexpected errors', () => {
  it('answers 500 with a generic body and never echoes the internal error message', async () => {
    app = await buildApp({ queryPostgisVersion: async () => '3.4.3' }, { logger: false });
    app.get('/boom', async () => {
      throw Object.assign(new Error('connection is insecure (try using `sslmode=require`)'), { code: '28000' });
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal_error' });
    expect(response.body).not.toContain('sslmode');
    expect(response.body).not.toContain('28000');
  });

  it('keeps client errors (4xx) as Fastify reports them', async () => {
    app = await buildApp({ queryPostgisVersion: async () => '3.4.3' }, { logger: false });
    app.get('/bad', async () => {
      throw Object.assign(new Error('bad input'), { statusCode: 400 });
    });

    const response = await app.inject({ method: 'GET', url: '/bad' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ statusCode: 400, message: 'bad input' });
  });
});
