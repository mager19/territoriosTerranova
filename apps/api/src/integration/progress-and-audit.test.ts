/**
 * Full-stack integration tests for slice 3 (progress entries + territory
 * audit history) against real PostGIS via Testcontainers. Own container,
 * separate from the other two integration files.
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
const PAUSE_POINT = { type: 'Point', coordinates: [-75.573, 6.358] };
const ROUTE = { type: 'LineString', coordinates: [[-75.5738, 6.3575], [-75.5732, 6.3585]] };
const REMAINING_AREA = {
  type: 'Polygon',
  coordinates: [[[-75.5735, 6.358], [-75.5725, 6.358], [-75.5725, 6.3585], [-75.5735, 6.3585], [-75.5735, 6.358]]]
};
// Collinear ring: closed, >= 4 positions, structurally a Polygon, but zero
// area — hits progress_entries_remaining_area_valid at the DB, not the
// app's structural check (mirrors packages/geo's own COLLINEAR fixture).
const ZERO_AREA_REMAINING = {
  type: 'Polygon',
  coordinates: [[[-75.574, 6.357], [-75.573, 6.358], [-75.572, 6.359], [-75.574, 6.357]]]
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
    .withDatabase('territorios_api_progress_test')
    .withUsername('territorios')
    .withPassword('territorios')
    .withStartupTimeout(300_000)
    .start();
  databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);
  await withClient((client) => client.query(FIXTURE_BOUNDARY_SQL));

  pool = new Pool({ connectionString: databaseUrl, max: 5 });
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

interface CreatedTerritory {
  readonly id: number;
}
interface CreatedAssignment {
  readonly id: number;
}

async function createTerritory(name: string, geometry: unknown = VALID_SQUARE): Promise<number> {
  const response = await app.inject({
    method: 'POST',
    url: '/admin/territories',
    payload: { name, geometry, author: 'admin-1' }
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as CreatedTerritory).id;
}

async function assignTerritory(territoryId: number): Promise<number> {
  const response = await app.inject({
    method: 'POST',
    url: `/admin/territories/${territoryId}/assignments`,
    payload: { assignedTo: 'worker-1', assignedBy: 'admin-1' }
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as CreatedAssignment).id;
}

describe('POST /admin/assignments/:id/progress', () => {
  it('records a progress entry with note only — remaining area is explicitly UNKNOWN, never inferred', async () => {
    const territoryId = await createTerritory('T-progress-01');
    const assignmentId = await assignTerritory(territoryId);

    const response = await app.inject({
      method: 'POST',
      url: `/admin/assignments/${assignmentId}/progress`,
      payload: { recordedBy: 'worker-1', note: 'started at the north corner' }
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      assignmentId,
      recordedBy: 'worker-1',
      note: 'started at the north corner',
      pausePoint: null,
      route: null,
      remainingArea: null,
      remainingAreaStatus: 'unknown'
    });
  });

  it('records a progress entry with pause point, route, and remaining area', async () => {
    const territoryId = await createTerritory('T-progress-02');
    const assignmentId = await assignTerritory(territoryId);

    const response = await app.inject({
      method: 'POST',
      url: `/admin/assignments/${assignmentId}/progress`,
      payload: {
        recordedBy: 'worker-1',
        pausePoint: PAUSE_POINT,
        route: ROUTE,
        remainingArea: REMAINING_AREA
      }
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.pausePoint).toEqual(PAUSE_POINT);
    expect(body.route).toEqual(ROUTE);
    expect(body.remainingArea).toEqual(REMAINING_AREA);
    expect(body.remainingAreaStatus).toBe('recorded');
  });

  it('rejects a zero-area remaining-area geometry at the database level with the correct field named', async () => {
    const territoryId = await createTerritory('T-progress-03');
    const assignmentId = await assignTerritory(territoryId);

    const response = await app.inject({
      method: 'POST',
      url: `/admin/assignments/${assignmentId}/progress`,
      payload: { recordedBy: 'worker-1', remainingArea: ZERO_AREA_REMAINING }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_geometry' });
    expect(response.json().message).toMatch(/remaining-area/);
  });

  it('rejects recording progress on a returned (non-active) assignment, with a distinct 409', async () => {
    const territoryId = await createTerritory('T-progress-04');
    const assignmentId = await assignTerritory(territoryId);
    await app.inject({ method: 'POST', url: `/admin/assignments/${assignmentId}/return`, payload: { actor: 'admin-1' } });

    const response = await app.inject({
      method: 'POST',
      url: `/admin/assignments/${assignmentId}/progress`,
      payload: { recordedBy: 'worker-1', note: 'too late' }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'assignment_not_active' });
  });

  it('returns assignment_not_found for a nonexistent assignment', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/assignments/999999/progress',
      payload: { recordedBy: 'worker-1' }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'assignment_not_found' });
  });

  it('rejects a raw UPDATE against progress_entries at the database level (immutable, proven directly)', async () => {
    const territoryId = await createTerritory('T-progress-05');
    const assignmentId = await assignTerritory(territoryId);
    const created = await app.inject({
      method: 'POST',
      url: `/admin/assignments/${assignmentId}/progress`,
      payload: { recordedBy: 'worker-1', note: 'first note' }
    });
    const entryId = created.json().id;

    await expect(
      withClient((client) => client.query(`UPDATE progress_entries SET note = 'tampered' WHERE id = $1`, [entryId]))
    ).rejects.toThrow(/append-only/);
  });
});

describe('GET /admin/assignments/:id/progress', () => {
  it('lists progress entries for an assignment in chronological order', async () => {
    const territoryId = await createTerritory('T-progress-list');
    const assignmentId = await assignTerritory(territoryId);
    await app.inject({
      method: 'POST',
      url: `/admin/assignments/${assignmentId}/progress`,
      payload: { recordedBy: 'worker-1', note: 'first' }
    });
    await app.inject({
      method: 'POST',
      url: `/admin/assignments/${assignmentId}/progress`,
      payload: { recordedBy: 'worker-1', note: 'second' }
    });

    const response = await app.inject({ method: 'GET', url: `/admin/assignments/${assignmentId}/progress` });
    expect(response.statusCode).toBe(200);
    const { entries } = response.json();
    expect(entries.map((e: { note: string }) => e.note)).toEqual(['first', 'second']);
  });

  it('returns assignment_not_found for a nonexistent assignment', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/assignments/999999/progress' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'assignment_not_found' });
  });
});

describe('GET /admin/territories/:id/audit', () => {
  it('exposes the full chronological history: territory events AND its assignments\' events, interleaved', async () => {
    const territoryId = await createTerritory('T-audit-01');
    const assignmentId = await assignTerritory(territoryId);
    await app.inject({
      method: 'POST',
      url: `/admin/assignments/${assignmentId}/progress`,
      payload: { recordedBy: 'worker-1', note: 'halfway done' }
    });
    await app.inject({ method: 'POST', url: `/admin/assignments/${assignmentId}/return`, payload: { actor: 'admin-1' } });
    await app.inject({
      method: 'POST',
      url: `/admin/assignments/${assignmentId}/reopen`,
      payload: { actor: 'admin-2', reason: 'found more area to cover' }
    });
    await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/revisions`,
      payload: {
        geometry: {
          type: 'Polygon',
          coordinates: [[[-75.5745, 6.3571], [-75.5721, 6.3571], [-75.5721, 6.3591], [-75.5745, 6.3591], [-75.5745, 6.3571]]]
        },
        author: 'admin-3'
      }
    });

    const response = await app.inject({ method: 'GET', url: `/admin/territories/${territoryId}/audit` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.territoryId).toBe(territoryId);
    expect(body.events.map((e: { action: string }) => e.action)).toEqual([
      'created',
      'assigned',
      'progress_recorded',
      'returned',
      'reopened',
      'revision_submitted'
    ]);
    // Every event traces back to something under THIS territory.
    for (const event of body.events) {
      expect(['territory', 'assignment']).toContain(event.entityType);
    }
  });

  it('returns territory_not_found for a nonexistent territory, not an empty list', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/territories/999999/audit' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'territory_not_found' });
  });

  it("does not leak another territory's assignment events", async () => {
    // Distinct, non-overlapping geometry for B — both territories must be
    // simultaneously active for this isolation check to mean anything, and
    // A2's overlap trigger correctly refuses two active territories sharing
    // the same footprint.
    const DISTINCT_SQUARE = {
      type: 'Polygon',
      coordinates: [[[-75.59, 6.34], [-75.585, 6.34], [-75.585, 6.345], [-75.59, 6.345], [-75.59, 6.34]]]
    };
    const territoryA = await createTerritory('T-audit-isolation-A');
    const territoryB = await createTerritory('T-audit-isolation-B', DISTINCT_SQUARE);
    const assignmentB = await assignTerritory(territoryB);
    await assignTerritory(territoryA);

    const response = await app.inject({ method: 'GET', url: `/admin/territories/${territoryA}/audit` });
    const events = response.json().events as Array<{ entityType: string; entityId: number }>;

    // The strong assertion: no event in A's history references B's assignment id.
    expect(events.some((e) => e.entityType === 'assignment' && e.entityId === assignmentB)).toBe(false);
    // And every assignment-typed event genuinely belongs to A, verified
    // against the database directly rather than trusting the payload.
    const assignmentEventIds = events.filter((e) => e.entityType === 'assignment').map((e) => e.entityId);
    if (assignmentEventIds.length > 0) {
      const belongsToA = await withClient(async (client) => {
        const { rows } = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM assignments WHERE id = ANY($1) AND territory_id <> $2`,
          [assignmentEventIds, territoryA]
        );
        return rows[0]?.n;
      });
      expect(belongsToA).toBe(0);
    }
  });
});
