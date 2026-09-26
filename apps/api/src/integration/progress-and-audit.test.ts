/**
 * Full-stack integration tests for progress entries + territory audit
 * history against real PostGIS via Testcontainers. Own container, separate
 * from the other two integration files.
 *
 * Progress is scoped directly to a territory — 2026-09-08: territories are
 * shared to a group of volunteers, not assigned to one named person
 * (db/migrations/0004_remove_individual_assignment.sql). There is no
 * "active assignment" precondition to record progress against anymore.
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
  app = await buildApp({ queryPostgisVersion: async () => '3.4.3', pool }, { logger: false });
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

async function createTerritory(name: string, geometry: unknown = VALID_SQUARE): Promise<number> {
  const response = await app.inject({
    method: 'POST',
    url: '/admin/territories',
    payload: { name, geometry, author: 'admin-1' }
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as CreatedTerritory).id;
}

describe('POST /admin/territories/:id/progress', () => {
  it('records a progress entry with note only — remaining area is explicitly UNKNOWN, never inferred', async () => {
    const territoryId = await createTerritory('T-progress-01');

    const response = await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-1', note: 'started at the north corner' }
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      territoryId,
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

    const response = await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
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

    const response = await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-1', remainingArea: ZERO_AREA_REMAINING }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_geometry' });
    expect(response.json().message).toMatch(/remaining-area/);
  });

  it('anyone can record progress at any time — there is no "must be assigned/active" precondition', async () => {
    const territoryId = await createTerritory('T-progress-04');

    const first = await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-1', note: 'first volunteer' }
    });
    const second = await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-2', note: 'a different volunteer, same territory' }
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
  });

  it('returns territory_not_found for a nonexistent territory', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories/999999/progress',
      payload: { recordedBy: 'worker-1' }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'territory_not_found' });
  });

  it('rejects a raw UPDATE against progress_entries at the database level (immutable, proven directly)', async () => {
    const territoryId = await createTerritory('T-progress-05');
    const created = await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-1', note: 'first note' }
    });
    const entryId = created.json().id;

    await expect(
      withClient((client) => client.query(`UPDATE progress_entries SET note = 'tampered' WHERE id = $1`, [entryId]))
    ).rejects.toThrow(/append-only/);
  });
});

describe('GET /admin/territories/:id/progress', () => {
  it('lists progress entries for a territory in chronological order', async () => {
    const territoryId = await createTerritory('T-progress-list');
    await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-1', note: 'first' }
    });
    await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-1', note: 'second' }
    });

    const response = await app.inject({ method: 'GET', url: `/admin/territories/${territoryId}/progress` });
    expect(response.statusCode).toBe(200);
    const { entries } = response.json();
    expect(entries.map((e: { note: string }) => e.note)).toEqual(['first', 'second']);
  });

  it('returns territory_not_found for a nonexistent territory', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/territories/999999/progress' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'territory_not_found' });
  });
});

describe('administrator-controlled operational cycles', () => {
  it('derives immutable cycle state, preserves the effective completion date, and resets pending coverage on reopening', async () => {
    const territoryId = await createTerritory('T-operational-cycle');

    const initially = await app.inject({ method: 'GET', url: `/admin/territories/${territoryId}/operational-state` });
    expect(initially.statusCode).toBe(200);
    expect(initially.json()).toMatchObject({ state: 'no_record', cycleNumber: null, remainingAreaStatus: 'unknown' });

    const open = await app.inject({
      method: 'POST', url: `/admin/territories/${territoryId}/operational-state`, payload: { action: 'in_progress', actor: 'admin-1' }
    });
    expect(open.statusCode).toBe(201);
    expect(open.json().state).toBe('in_progress');

    const coverage = await app.inject({
      method: 'POST', url: `/admin/territories/${territoryId}/progress`, payload: { recordedBy: 'admin-1', remainingArea: REMAINING_AREA }
    });
    expect(coverage.statusCode).toBe(201);

    const paused = await app.inject({
      method: 'POST', url: `/admin/territories/${territoryId}/operational-state`, payload: { action: 'paused', actor: 'admin-1' }
    });
    expect(paused.statusCode).toBe(201);
    expect(paused.json()).toMatchObject({ state: 'paused', remainingArea: REMAINING_AREA, remainingAreaStatus: 'recorded' });

    const completed = await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/operational-state`,
      payload: { action: 'cycle_completed', actor: 'admin-1', effectiveCompletionDate: '2026-09-21' }
    });
    expect(completed.statusCode).toBe(201);
    expect(completed.json()).toMatchObject({ state: 'cycle_completed', effectiveCompletionDate: '2026-09-21' });

    const withoutReason = await app.inject({
      method: 'POST', url: `/admin/territories/${territoryId}/operational-state`, payload: { action: 'reopened', actor: 'admin-1' }
    });
    expect(withoutReason.statusCode).toBe(400);

    const reopened = await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/operational-state`,
      payload: { action: 'reopened', actor: 'admin-1', reason: 'new addresses need coverage' }
    });
    expect(reopened.statusCode).toBe(201);
    expect(reopened.json()).toMatchObject({ state: 'reopened', cycleNumber: 2, remainingArea: null, remainingAreaStatus: 'unknown' });

    await expect(
      withClient((client) => client.query(`UPDATE territory_operational_events SET reason = 'tampered' WHERE territory_id = $1`, [territoryId]))
    ).rejects.toThrow(/append-only/);

    const history = await app.inject({ method: 'GET', url: `/admin/territories/${territoryId}/audit` });
    expect(history.json().events.map((event: { action: string }) => event.action)).toEqual([
      'created', 'operational_in_progress', 'progress_recorded', 'operational_paused', 'operational_cycle_completed', 'operational_reopened'
    ]);
  });

  it('rejects progress after completion until an administrator explicitly reopens the cycle', async () => {
    const territoryId = await createTerritory('T-operational-completed');
    await app.inject({
      method: 'POST', url: `/admin/territories/${territoryId}/operational-state`, payload: { action: 'in_progress', actor: 'admin-1' }
    });
    await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/operational-state`,
      payload: { action: 'cycle_completed', actor: 'admin-1', effectiveCompletionDate: '2026-09-21' }
    });
    const response = await app.inject({
      method: 'POST', url: `/admin/territories/${territoryId}/progress`, payload: { recordedBy: 'admin-1', route: ROUTE }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });
});

describe('GET /admin/territories/:id/audit', () => {
  it('exposes the full chronological history for a territory: creation, sharing, progress, and new revisions', async () => {
    const territoryId = await createTerritory('T-audit-01');
    await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/share-tokens`,
      payload: { createdBy: 'admin-1' }
    });
    await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-1', note: 'halfway done' }
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
      'shared',
      'operational_in_progress',
      'progress_recorded',
      'revision_submitted'
    ]);
    // Everything is territory-scoped now — no separate 'assignment' entity type exists.
    for (const event of body.events) {
      expect(event.entityType).toBe('territory');
      expect(event.entityId).toBe(territoryId);
    }
  });

  it('returns territory_not_found for a nonexistent territory, not an empty list', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/territories/999999/audit' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'territory_not_found' });
  });

  it("does not leak another territory's progress/share events", async () => {
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
    await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryB}/progress`,
      payload: { recordedBy: 'worker-1', note: 'B only' }
    });

    const response = await app.inject({ method: 'GET', url: `/admin/territories/${territoryA}/audit` });
    const events = response.json().events as Array<{ entityId: number; reason: string }>;

    expect(events.every((e) => e.entityId === territoryA)).toBe(true);
    expect(events.some((e) => e.reason === 'B only')).toBe(false);
  });
});
