import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';

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
