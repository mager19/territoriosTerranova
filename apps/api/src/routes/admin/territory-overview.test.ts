/**
 * Validation branches only, using the repo's poison-pool pattern: the pool
 * throws if connected to at all, proving these requests are rejected before
 * any database round trip. Real aggregation behaviour lives in
 * src/integration/territory-overview.test.ts.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../app.js';
import type { TransactionalPool } from '../../db/transaction.js';
import {
  asAdmin,
  createInMemoryAdminSessionStore,
  sessionCookieFor,
  testAuthConfig,
  type AuthenticatedClient
} from '../../test-support/admin-auth.js';

const poisonPool: TransactionalPool = {
  connect: async () => {
    throw new Error('validation should have rejected this request before touching the database');
  }
};

let app: FastifyInstance | undefined;
let admin: AuthenticatedClient;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Every request through `admin` carries a valid session (in-memory store): these tests exercise validation, not the guard (see auth/admin-guard.test.ts). */
async function buildTestApp(): Promise<FastifyInstance> {
  const sessions = createInMemoryAdminSessionStore();
  const built = await buildApp(
    { queryPostgisVersion: async () => '3.4.3', pool: poisonPool, auth: { config: testAuthConfig(), sessions } },
    { logger: false }
  );
  admin = asAdmin(built, await sessionCookieFor(sessions));
  return built;
}

describe('GET /admin/territories/overview — validation branches', () => {
  it('rejects a non-numeric months without touching the database', async () => {
    app = await buildTestApp();
    const response = await admin.inject({ method: 'GET', url: '/admin/territories/overview?months=abc' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects months below 1', async () => {
    app = await buildTestApp();
    const response = await admin.inject({ method: 'GET', url: '/admin/territories/overview?months=0' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects months above 24', async () => {
    app = await buildTestApp();
    const response = await admin.inject({ method: 'GET', url: '/admin/territories/overview?months=25' });

    expect(response.statusCode).toBe(400);
  });

  it('does not fall through to the /admin/territories/:id route', async () => {
    app = await buildTestApp();
    const response = await admin.inject({ method: 'GET', url: '/admin/territories/overview?months=0' });

    // The :id handler's rejection message would be about territory ids.
    expect(response.json().message).not.toContain('territory id');
  });
});
