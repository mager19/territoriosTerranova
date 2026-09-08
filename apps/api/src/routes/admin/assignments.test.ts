/**
 * Route-level unit tests for validation branches only — same discipline as
 * territories.test.ts. Full happy-path, conflict-mapping, and concurrency
 * behavior is proven against real PostGIS in
 * src/integration/assignments.test.ts.
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

describe('POST /admin/territories/:id/assignments — validation branches', () => {
  it('rejects a non-integer territory id without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories/not-a-number/assignments',
      payload: { assignedTo: 'worker-1', assignedBy: 'admin-1' }
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /admin/assignments/:id/return — validation branches', () => {
  it('rejects a blank actor without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/assignments/1/return',
      payload: { actor: '  ' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects a non-integer assignment id without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/assignments/not-a-number/return',
      payload: { actor: 'admin-1' }
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /admin/assignments/:id/complete — validation branches', () => {
  it('rejects a blank actor without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/assignments/1/complete',
      payload: {}
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });
});

describe('POST /admin/assignments/:id/reopen — validation branches', () => {
  it('rejects a blank reason without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/assignments/1/reopen',
      payload: { actor: 'admin-1', reason: '   ' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects a blank actor without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/assignments/1/reopen',
      payload: { actor: '', reason: 'coverage gap found' }
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a missing reason without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/assignments/1/reopen',
      payload: { actor: 'admin-1' }
    });
    expect(response.statusCode).toBe(400);
  });
});
