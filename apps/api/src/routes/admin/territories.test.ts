/**
 * Route-level unit tests for validation branches only (A3 brief DoD: "every
 * endpoint has unit tests for its validation branches"). Each test injects a
 * "poison pool" whose connect() throws if called at all — proving these
 * requests are rejected by validation BEFORE any database round trip, not
 * merely that they eventually 404/400 for some other reason.
 *
 * Full happy-path and DB-error-mapping behavior (out of bounds, overlap,
 * immutability, audit events) is proven against real PostGIS in
 * src/integration/territories.test.ts — mocking a multi-statement SQL
 * transaction here would test the mock, not the system.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../app.js';
import type { TransactionalPool } from '../../db/transaction.js';

const VALID_SQUARE = {
  type: 'Polygon',
  coordinates: [
    [
      [-75.574, 6.357],
      [-75.572, 6.357],
      [-75.572, 6.359],
      [-75.574, 6.359],
      [-75.574, 6.357]
    ]
  ]
};

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
  return buildApp(
    { queryPostgisVersion: async () => '3.4.3', pool: poisonPool },
    { logger: false }
  );
}

describe('POST /admin/territories — validation branches', () => {
  it('rejects a blank name without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: '   ', geometry: VALID_SQUARE, author: 'admin-1' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects a blank author without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: 'T-01', geometry: VALID_SQUARE, author: '' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects a non-Polygon geometry without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: 'T-01', geometry: { type: 'Point', coordinates: [0, 0] }, author: 'admin-1' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_geometry' });
  });

  it('rejects a missing geometry field without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: 'T-01', author: 'admin-1' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_geometry' });
  });
});

describe('POST /admin/territories/:id/revisions — validation branches', () => {
  it('rejects a non-integer territory id without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories/not-a-number/revisions',
      payload: { geometry: VALID_SQUARE, author: 'admin-1' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects an invalid geometry without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories/1/revisions',
      payload: { geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, author: 'admin-1' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_geometry' });
  });
});

describe('GET /admin/territories/:id — validation branches', () => {
  it('rejects a non-integer territory id without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/admin/territories/not-a-number' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects a zero or negative territory id without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/admin/territories/0' });
    expect(response.statusCode).toBe(400);
  });
});

describe('admin routes are absent when no pool is supplied', () => {
  it('does not register admin territory routes for a health-only app (A1 compatibility)', async () => {
    app = await buildApp({ queryPostgisVersion: async () => '3.4.3' }, { logger: false });
    const response = await app.inject({ method: 'GET', url: '/admin/territories' });
    expect(response.statusCode).toBe(404);
  });
});
