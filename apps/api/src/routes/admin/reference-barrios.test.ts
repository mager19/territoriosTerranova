/**
 * Route-level unit tests for validation branches only — same "poison pool"
 * pattern as territories.test.ts: proves a missing/blank name is rejected
 * BEFORE any database round trip. Real search behavior against seeded data
 * is proven against real PostGIS in src/integration/reference-barrios.test.ts.
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

describe('GET /admin/reference/barrios — validation branches', () => {
  it('rejects a missing name query param without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/admin/reference/barrios' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects a blank (whitespace-only) name query param without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/admin/reference/barrios?name=%20%20' });

    expect(response.statusCode).toBe(400);
  });
});
