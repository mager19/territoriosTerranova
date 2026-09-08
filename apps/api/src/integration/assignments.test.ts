/**
 * Full-stack integration tests for slice 2 (assignment lifecycle) against
 * real PostGIS via Testcontainers, exercised through the actual HTTP
 * routes. Own container, separate from territories.test.ts (Testcontainers
 * pool is 'forks'/no file parallelism, so each integration file gets an
 * isolated database — no shared state between the two suites).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '@territorios/geo/db/migrate';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../app.js';

const IMAGE = 'postgis/postgis:16-3.4';

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

const FIXTURE_BOUNDARY_SQL = `
  INSERT INTO reference_municipal_boundary (id, name, geom, source_url, retrieved_at, attribution)
  VALUES (1, 'Bello (test fixture envelope)',
          ST_Multi(ST_SetSRID(ST_MakeEnvelope(-75.70, 6.20, -75.40, 6.55), 4326)),
          'integration-test-fixture', now(),
          'test fixture; see packages/geo/src/integration/db.test.ts for the real-boundary equivalent')
`;

let container: StartedPostgreSqlContainer;
let databaseUrl: string;
let pool: Pool;
let app: FastifyInstance;

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(IMAGE)
    .withDatabase('territorios_api_assignments_test')
    .withUsername('territorios')
    .withPassword('territorios')
    .withStartupTimeout(300_000)
    .start();
  databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);
  await withClient((client) => client.query(FIXTURE_BOUNDARY_SQL));

  pool = new Pool({ connectionString: databaseUrl, max: 10 });
  app = buildApp({ queryPostgisVersion: async () => '3.4.3', pool }, { logger: false });
}, 360_000);

afterEach(async () => {
  await withClient((client) => client.query(`UPDATE territories SET status = 'archived' WHERE status = 'active'`));
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

async function createTerritory(name: string): Promise<number> {
  const response = await app.inject({
    method: 'POST',
    url: '/admin/territories',
    payload: { name, geometry: VALID_SQUARE, author: 'admin-1' }
  });
  expect(response.statusCode).toBe(201);
  return response.json().id;
}

interface AssignmentBody {
  readonly id: number;
  readonly territoryRevisionId: number;
  readonly status: string;
  readonly [key: string]: unknown;
}

async function assign(
  territoryId: number,
  assignedTo = 'worker-1'
): Promise<{ statusCode: number; body: AssignmentBody }> {
  const response = await app.inject({
    method: 'POST',
    url: `/admin/territories/${territoryId}/assignments`,
    payload: { assignedTo, assignedBy: 'admin-1' }
  });
  return { statusCode: response.statusCode, body: response.json() as AssignmentBody };
}

async function auditEventsFor(entityType: string, entityId: number): Promise<Array<{ action: string; actor: string; reason: string }>> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ action: string; actor: string; reason: string }>(
      `SELECT action, actor, reason FROM audit_events WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at`,
      [entityType, entityId]
    );
    return rows;
  });
}

describe('POST /admin/territories/:id/assignments', () => {
  it('assigns a territory and records an audit event', async () => {
    const territoryId = await createTerritory('T-assign-01');
    const { statusCode, body } = await assign(territoryId, 'worker-1');

    expect(statusCode).toBe(201);
    expect(body).toMatchObject({
      territoryId,
      assignedTo: 'worker-1',
      assignedBy: 'admin-1',
      status: 'active',
      revisionNumber: 1
    });
    expect(body.completedAt).toBeNull();
    expect(body.returnedAt).toBeNull();

    const events = await auditEventsFor('assignment', body.id);
    expect(events).toEqual([{ action: 'assigned', actor: 'admin-1', reason: 'territory assigned to worker-1' }]);
  });

  it('returns territory_not_found for a nonexistent territory', async () => {
    const { statusCode, body } = await assign(999999);
    expect(statusCode).toBe(404);
    expect(body).toMatchObject({ error: 'territory_not_found' });
  });

  it('rejects a second assignment while one is already active, with a distinct 409 (not a bare 500)', async () => {
    const territoryId = await createTerritory('T-assign-02');
    const first = await assign(territoryId, 'worker-1');
    expect(first.statusCode).toBe(201);

    const second = await assign(territoryId, 'worker-2');
    expect(second.statusCode).toBe(409);
    expect(second.body).toMatchObject({ error: 'active_assignment_conflict' });
  });

  it('yields exactly one active assignment when two requests race for the same territory (real concurrency)', async () => {
    const territoryId = await createTerritory('T-assign-race');

    const [a, b] = await Promise.all([assign(territoryId, 'worker-A'), assign(territoryId, 'worker-B')]);

    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(loser.body).toMatchObject({ error: 'active_assignment_conflict' });

    const activeCount = await withClient(async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM assignments WHERE territory_id = $1 AND status = 'active'`,
        [territoryId]
      );
      return rows[0]?.n;
    });
    expect(activeCount).toBe(1);
  });
});

describe('POST /admin/assignments/:id/return and /complete', () => {
  it('returns an active assignment, sets returned_at, and records an audit event', async () => {
    const territoryId = await createTerritory('T-return-01');
    const { body: created } = await assign(territoryId);

    const response = await app.inject({
      method: 'POST',
      url: `/admin/assignments/${created.id}/return`,
      payload: { actor: 'admin-1' }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('returned');
    expect(body.returnedAt).not.toBeNull();

    const events = await auditEventsFor('assignment', created.id);
    expect(events.map((e) => e.action)).toEqual(['assigned', 'returned']);
  });

  it('completes an active assignment, sets completed_at, and records an audit event', async () => {
    const territoryId = await createTerritory('T-complete-01');
    const { body: created } = await assign(territoryId);

    const response = await app.inject({
      method: 'POST',
      url: `/admin/assignments/${created.id}/complete`,
      payload: { actor: 'admin-1' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'completed' });
  });

  it('rejects returning an assignment that is not active, with a distinct 409', async () => {
    const territoryId = await createTerritory('T-return-02');
    const { body: created } = await assign(territoryId);
    await app.inject({ method: 'POST', url: `/admin/assignments/${created.id}/return`, payload: { actor: 'admin-1' } });

    const secondReturn = await app.inject({
      method: 'POST',
      url: `/admin/assignments/${created.id}/return`,
      payload: { actor: 'admin-1' }
    });
    expect(secondReturn.statusCode).toBe(409);
    expect(secondReturn.json()).toMatchObject({ error: 'assignment_not_active' });
  });

  it('returns assignment_not_found for a nonexistent assignment', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/assignments/999999/complete',
      payload: { actor: 'admin-1' }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'assignment_not_found' });
  });
});

describe('POST /admin/assignments/:id/reopen', () => {
  it('reopens a returned assignment with a reason, preserving its original revision reference', async () => {
    const territoryId = await createTerritory('T-reopen-01');
    const { body: created } = await assign(territoryId);
    await app.inject({ method: 'POST', url: `/admin/assignments/${created.id}/return`, payload: { actor: 'admin-1' } });

    const response = await app.inject({
      method: 'POST',
      url: `/admin/assignments/${created.id}/reopen`,
      payload: { actor: 'admin-2', reason: 'coverage gap found after return' }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      status: 'active',
      reopenReason: 'coverage gap found after return',
      territoryRevisionId: created.territoryRevisionId
    });

    const events = await auditEventsFor('assignment', created.id);
    expect(events.map((e) => e.action)).toEqual(['assigned', 'returned', 'reopened']);
    expect(events[2]).toMatchObject({ actor: 'admin-2', reason: 'coverage gap found after return' });
  });

  it('rejects reopening WITHOUT a reason at the app level, never touching a blank reason down to the trigger', async () => {
    const territoryId = await createTerritory('T-reopen-02');
    const { body: created } = await assign(territoryId);
    await app.inject({ method: 'POST', url: `/admin/assignments/${created.id}/return`, payload: { actor: 'admin-1' } });

    const response = await app.inject({
      method: 'POST',
      url: `/admin/assignments/${created.id}/reopen`,
      payload: { actor: 'admin-1', reason: '   ' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });

    // Proves it was truly rejected before reopening, not silently accepted.
    const stillReturned = await withClient(async (client) => {
      const { rows } = await client.query<{ status: string }>(`SELECT status FROM assignments WHERE id = $1`, [
        created.id
      ]);
      return rows[0]?.status;
    });
    expect(stillReturned).toBe('returned');
  });

  it('the database itself rejects a blank reopen_reason too (defense-in-depth, bypassing the app check directly)', async () => {
    const territoryId = await createTerritory('T-reopen-03');
    const { body: created } = await assign(territoryId);
    await app.inject({ method: 'POST', url: `/admin/assignments/${created.id}/return`, payload: { actor: 'admin-1' } });

    await expect(
      withClient((client) =>
        client.query(`UPDATE assignments SET status = 'active', reopen_reason = '' WHERE id = $1`, [created.id])
      )
    ).rejects.toThrow(/requires a reopen_reason/);
  });

  it('rejects reopening an assignment that is already active', async () => {
    const territoryId = await createTerritory('T-reopen-04');
    const { body: created } = await assign(territoryId);

    const response = await app.inject({
      method: 'POST',
      url: `/admin/assignments/${created.id}/reopen`,
      payload: { actor: 'admin-1', reason: 'not applicable' }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'assignment_not_active' });
  });

  it('rejects reopening into a territory that already has a different active assignment, with a distinct 409', async () => {
    const territoryId = await createTerritory('T-reopen-05');
    const { body: first } = await assign(territoryId, 'worker-1');
    await app.inject({ method: 'POST', url: `/admin/assignments/${first.id}/return`, payload: { actor: 'admin-1' } });
    const { body: second } = await assign(territoryId, 'worker-2'); // now active, occupying the one-active slot

    const response = await app.inject({
      method: 'POST',
      url: `/admin/assignments/${first.id}/reopen`,
      payload: { actor: 'admin-1', reason: 'trying to reopen the old one anyway' }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'active_assignment_conflict' });

    // The genuinely active one (second) is untouched.
    const stillActive = await withClient(async (client) => {
      const { rows } = await client.query<{ status: string }>(`SELECT status FROM assignments WHERE id = $1`, [
        second.id
      ]);
      return rows[0]?.status;
    });
    expect(stillActive).toBe('active');
  });
});
