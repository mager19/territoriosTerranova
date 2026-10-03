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

const COVERED_AREA = {
  type: 'Polygon',
  coordinates: [[[-75.574, 6.357], [-75.573, 6.357], [-75.573, 6.358], [-75.574, 6.358], [-75.574, 6.357]]]
};

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
      payload: { recordedBy: 'worker-1', coveredArea: COVERED_AREA, pausePoint: { type: 'Polygon', coordinates: [] } }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_geometry' });
  });

  it('rejects an invalid route without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories/1/progress',
      payload: { recordedBy: 'worker-1', coveredArea: COVERED_AREA, route: { type: 'Point', coordinates: [0, 0] } }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_geometry' });
  });

  it('rejects a client-supplied remaining area — it is always computed by the server', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories/1/progress',
      payload: { recordedBy: 'worker-1', coveredArea: COVERED_AREA, remainingArea: COVERED_AREA }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
    expect(response.json().message).toMatch(/computed by the server/);
  });

  it('rejects a session without a covered area without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories/1/progress',
      payload: { recordedBy: 'worker-1', note: 'note only', route: { type: 'LineString', coordinates: [[-75.574, 6.357], [-75.573, 6.358]] } }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
    expect(response.json().message).toMatch(/coveredArea is required/);
  });

  it('rejects a covered area that is not a Polygon without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories/1/progress',
      payload: { recordedBy: 'worker-1', coveredArea: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_geometry' });
  });

  it('rejects an unknown baseline value without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories/1/progress',
      payload: { recordedBy: 'worker-1', coveredArea: COVERED_AREA, baseline: 'guess_it' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
    expect(response.json().message).toMatch(/baseline/);
  });
});

describe('GET /admin/territories/:id/progress — validation branches', () => {
  it('rejects a non-integer territory id without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/admin/territories/not-a-number/progress' });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /admin/territories/:id/cycles — validation branches', () => {
  it('rejects a non-integer territory id without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/admin/territories/not-a-number/cycles' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });
});
