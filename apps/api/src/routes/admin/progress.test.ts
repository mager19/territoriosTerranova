/**
 * Route-level unit tests for validation branches only — same discipline as
 * territories.test.ts. Full happy-path and DB-error-mapping behavior is
 * proven against real PostGIS in src/integration/progress-and-audit.test.ts.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../app.js';
import type { TransactionalPool } from '../../db/transaction.js';

const poisonPool: TransactionalPool = {
  connect: async () => {
    throw new Error('validation should have rejected this request before touching the database');
  }
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function buildTestApp(): Promise<FastifyInstance> {
  return buildApp({ queryPostgisVersion: async () => '3.4.3', pool: poisonPool }, { logger: false });
}

describe('POST /admin/territories/:id/progress — validation branches', () => {
  it('rejects a blank recordedBy without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories/1/progress',
      payload: { recordedBy: '   ' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects a non-integer territory id without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories/not-a-number/progress',
      payload: { recordedBy: 'worker-1' }
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an invalid pause point without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories/1/progress',
      payload: { recordedBy: 'worker-1', pausePoint: { type: 'Polygon', coordinates: [] } }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_geometry' });
  });

  it('rejects an invalid route without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories/1/progress',
      payload: { recordedBy: 'worker-1', route: { type: 'Point', coordinates: [0, 0] } }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_geometry' });
  });

  it('rejects an invalid remaining-area geometry without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories/1/progress',
      payload: { recordedBy: 'worker-1', remainingArea: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_geometry' });
  });
});

describe('GET /admin/territories/:id/progress — validation branches', () => {
  it('rejects a non-integer territory id without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/admin/territories/not-a-number/progress' });
    expect(response.statusCode).toBe(400);
  });
});
