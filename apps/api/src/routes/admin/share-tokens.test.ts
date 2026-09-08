/**
 * Route-level unit tests for validation branches only — same discipline as
 * the other admin route test files. Full happy-path and DB behavior is
 * proven against real PostGIS in src/integration/sharing.test.ts.
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

describe('POST /admin/assignments/:id/share-tokens — validation branches', () => {
  it('rejects a non-integer assignment id without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/assignments/not-a-number/share-tokens',
      payload: {}
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed expiresAt without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/assignments/1/share-tokens',
      payload: { expiresAt: 'not-a-date' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });
});

describe('POST /admin/share-tokens/:id/revoke — validation branches', () => {
  it('rejects a non-integer token id without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'POST', url: '/admin/share-tokens/not-a-number/revoke' });
    expect(response.statusCode).toBe(400);
  });
});
