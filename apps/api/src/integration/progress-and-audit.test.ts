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
import { createPgAdminSessionStore, type AdminSessionStore } from '../auth/session-store.js';
import {
  TEST_ADMIN_EMAIL,
  asAdmin,
  sessionCookieFor,
  testAuthConfig,
  type AuthenticatedClient
} from '../test-support/admin-auth.js';

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
function rectangle(west: number, south: number, east: number, north: number) {
  return {
    type: 'Polygon',
    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]]
  };
}
// Sub-areas of VALID_SQUARE (lon -75.574..-75.572, lat 6.357..6.359).
const WEST_HALF = rectangle(-75.574, 6.357, -75.573, 6.359);
const EAST_HALF = rectangle(-75.573, 6.357, -75.572, 6.359);
const NORTH_EAST_QUARTER = rectangle(-75.573, 6.358, -75.572, 6.359);
const SOUTH_EAST_QUARTER = rectangle(-75.573, 6.357, -75.572, 6.358);
const MIDDLE_STRIP = rectangle(-75.5735, 6.357, -75.5725, 6.359);
const OUTSIDE_TERRITORY = rectangle(-75.58, 6.357, -75.578, 6.359);
const CROSSING_BOUNDARY = rectangle(-75.5725, 6.357, -75.571, 6.359);
// Collinear ring: closed, >= 4 positions, structurally a Polygon, but zero
// area (mirrors packages/geo's own COLLINEAR fixture).
const ZERO_AREA_COVERED = {
  type: 'Polygon',
  coordinates: [[[-75.574, 6.357], [-75.573, 6.358], [-75.572, 6.359], [-75.574, 6.357]]]
};
// Self-intersecting "bowtie": structurally closed, invalid for PostGIS.
const BOWTIE_COVERED = {
  type: 'Polygon',
  coordinates: [[[-75.574, 6.357], [-75.572, 6.359], [-75.572, 6.357], [-75.574, 6.359], [-75.574, 6.357]]]
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
let sessions: AdminSessionStore;
/** Every admin request goes through a real session (admin_sessions in this container) for TEST_ADMIN_EMAIL. */
let admin: AuthenticatedClient;

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
  sessions = createPgAdminSessionStore(pool);
  app = await buildApp(
    { queryPostgisVersion: async () => '3.4.3', pool, auth: { config: testAuthConfig(), sessions } },
    { logger: false }
  );
  admin = asAdmin(app, await sessionCookieFor(sessions, TEST_ADMIN_EMAIL));
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
  const response = await admin.inject({
    method: 'POST',
    url: '/admin/territories',
    payload: { name, geometry, author: 'admin-1' }
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as CreatedTerritory).id;
}

interface SessionPayload {
  readonly recordedBy?: string;
  readonly note?: string;
  readonly coveredArea?: unknown;
  readonly baseline?: 'whole_territory';
  readonly pausePoint?: unknown;
  readonly route?: unknown;
}

/** Explicitly opens the territory's first cycle — recording progress requires an open territory (2026-10-03). */
async function openTerritory(territoryId: number): Promise<void> {
  const response = await admin.inject({
    method: 'POST',
    url: `/admin/territories/${territoryId}/operational-state`,
    payload: { action: 'in_progress', actor: 'admin-1' }
  });
  expect(response.statusCode).toBe(201);
}

async function createOpenTerritory(name: string, geometry: unknown = VALID_SQUARE): Promise<number> {
  const territoryId = await createTerritory(name, geometry);
  await openTerritory(territoryId);
  return territoryId;
}

function recordSession(territoryId: number, payload: SessionPayload) {
  return admin.inject({
    method: 'POST',
    url: `/admin/territories/${territoryId}/progress`,
    payload: { recordedBy: 'admin-1', ...payload }
  });
}

function operationalState(territoryId: number) {
  return admin.inject({ method: 'GET', url: `/admin/territories/${territoryId}/operational-state` });
}

function changeState(territoryId: number, payload: Record<string, unknown>) {
  return admin.inject({
    method: 'POST',
    url: `/admin/territories/${territoryId}/operational-state`,
    payload: { actor: 'admin-1', ...payload }
  });
}

/** Geometric equality decided by PostGIS, not by vertex order in a GeoJSON string. */
async function remainingEquals(entryId: number, expected: unknown): Promise<boolean> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ equal: boolean }>(
      `SELECT ST_Equals(remaining_area, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)) AS equal
       FROM progress_entries WHERE id = $1`,
      [entryId, JSON.stringify(expected)]
    );
    return rows[0]?.equal === true;
  });
}

async function countEntries(territoryId: number): Promise<number> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ count: string }>(
      'SELECT count(*) AS count FROM progress_entries WHERE territory_id = $1',
      [territoryId]
    );
    return Number(rows[0]?.count ?? 0);
  });
}

describe('POST /admin/territories/:id/progress', () => {
  it('rejects a note-only entry — every new session must carry the area it covered', async () => {
    const territoryId = await createOpenTerritory('T-progress-01');

    const response = await recordSession(territoryId, { recordedBy: 'worker-1', note: 'started at the north corner' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
    expect(await countEntries(territoryId)).toBe(0);
  });

  it('records a session with covered area, pause point, and route — the remaining area is derived, never sent', async () => {
    const territoryId = await createOpenTerritory('T-progress-02');

    const response = await recordSession(territoryId, {
      recordedBy: 'worker-1',
      coveredArea: WEST_HALF,
      baseline: 'whole_territory',
      pausePoint: PAUSE_POINT,
      route: ROUTE
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.pausePoint).toEqual(PAUSE_POINT);
    expect(body.route).toEqual(ROUTE);
    expect(body.coveredArea).toEqual(WEST_HALF);
    expect(body.baseline).toBe('whole_territory');
    expect(body.cycleNumber).toBe(1);
    expect(body.remainingAreaStatus).toBe('recorded');
    expect(await remainingEquals(body.id, EAST_HALF)).toBe(true);
  });

  it('rejects a zero-area covered area with the field named', async () => {
    const territoryId = await createOpenTerritory('T-progress-03');

    const response = await recordSession(territoryId, { coveredArea: ZERO_AREA_COVERED, baseline: 'whole_territory' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'zero_area_geometry' });
    expect(response.json().message).toMatch(/covered-area/);
    expect(await countEntries(territoryId)).toBe(0);
  });

  it('rejects a self-intersecting covered area instead of repairing it', async () => {
    const territoryId = await createOpenTerritory('T-progress-bowtie');

    const response = await recordSession(territoryId, { coveredArea: BOWTIE_COVERED, baseline: 'whole_territory' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_geometry' });
    expect(response.json().message).toMatch(/covered-area/);
  });

  it('anyone can record progress on an open territory — there is no "must be assigned" precondition', async () => {
    const territoryId = await createOpenTerritory('T-progress-04');

    const first = await recordSession(territoryId, {
      recordedBy: 'worker-1',
      note: 'first volunteer',
      coveredArea: WEST_HALF,
      baseline: 'whole_territory'
    });
    const second = await recordSession(territoryId, {
      recordedBy: 'worker-2',
      note: 'a different volunteer, same territory',
      coveredArea: NORTH_EAST_QUARTER
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
  });

  it('returns territory_not_found for a nonexistent territory', async () => {
    const response = await recordSession(999999, { recordedBy: 'worker-1', coveredArea: WEST_HALF, baseline: 'whole_territory' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'territory_not_found' });
  });

  it('rejects a raw UPDATE against progress_entries at the database level (immutable, proven directly)', async () => {
    const territoryId = await createOpenTerritory('T-progress-05');
    const created = await recordSession(territoryId, { note: 'first note', coveredArea: WEST_HALF, baseline: 'whole_territory' });
    const entryId = created.json().id;

    await expect(
      withClient((client) => client.query(`UPDATE progress_entries SET note = 'tampered' WHERE id = $1`, [entryId]))
    ).rejects.toThrow(/append-only/);
    await expect(
      withClient((client) => client.query(`UPDATE progress_entries SET covered_area = NULL WHERE id = $1`, [entryId]))
    ).rejects.toThrow(/append-only/);
    await expect(
      withClient((client) => client.query(`DELETE FROM progress_entries WHERE id = $1`, [entryId]))
    ).rejects.toThrow(/append-only/);
  });
});

describe('coverage sessions — remaining area = previous remaining MINUS covered', () => {
  it('subtracts across two sessions and derives progress from geodesic areas', async () => {
    const territoryId = await createOpenTerritory('T-coverage-two-sessions');

    const first = await recordSession(territoryId, { coveredArea: WEST_HALF, baseline: 'whole_territory' });
    expect(first.statusCode).toBe(201);
    expect(await remainingEquals(first.json().id, EAST_HALF)).toBe(true);
    const afterFirst = (await operationalState(territoryId)).json();
    expect(afterFirst.progressPercent).toBeCloseTo(50, 0);

    // The second session's covered area also re-covers part of the west half:
    // only its overlap with what REMAINS changes the result.
    const second = await recordSession(territoryId, { coveredArea: rectangle(-75.5735, 6.358, -75.572, 6.359) });
    expect(second.statusCode).toBe(201);
    expect(second.json().baseline).toBeNull();
    expect(await remainingEquals(second.json().id, SOUTH_EAST_QUARTER)).toBe(true);

    const afterSecond = (await operationalState(territoryId)).json();
    expect(afterSecond.remainingAreaStatus).toBe('recorded');
    expect(afterSecond.progressPercent).toBeCloseTo(75, 0);
  });

  it('keeps a split remaining area as a MultiPolygon', async () => {
    const territoryId = await createOpenTerritory('T-coverage-split');

    const response = await recordSession(territoryId, { coveredArea: MIDDLE_STRIP, baseline: 'whole_territory' });
    expect(response.statusCode).toBe(201);
    expect(response.json().remainingArea.type).toBe('MultiPolygon');
    expect(response.json().remainingArea.coordinates).toHaveLength(2);
  });

  it('covers a multi-part territory part by part: remaining = territory minus covered, across parts', async () => {
    // Two disjoint parts with a ~200 m gap (the creek).
    const west = rectangle(-75.546, 6.33, -75.544, 6.332);
    const east = rectangle(-75.542, 6.33, -75.54, 6.332);
    const territoryId = await createOpenTerritory('T-coverage-multipart', {
      type: 'MultiPolygon',
      coordinates: [west.coordinates, east.coordinates]
    });

    // A covered area spanning the gap does NOT lie within the territory.
    const acrossGap = await recordSession(territoryId, {
      coveredArea: rectangle(-75.545, 6.3305, -75.541, 6.3315),
      baseline: 'whole_territory'
    });
    expect(acrossGap.statusCode).toBe(400);
    expect(acrossGap.json()).toMatchObject({ error: 'out_of_bounds' });

    // Covering the whole WEST part leaves exactly the east part.
    const first = await recordSession(territoryId, { coveredArea: west, baseline: 'whole_territory' });
    expect(first.statusCode).toBe(201);
    expect(await remainingEquals(first.json().id, east)).toBe(true);
    expect((await operationalState(territoryId)).json().progressPercent).toBeCloseTo(50, 0);

    // Half of the east part: remaining is the other half of the east part.
    const second = await recordSession(territoryId, { coveredArea: rectangle(-75.542, 6.33, -75.541, 6.332) });
    expect(second.statusCode).toBe(201);
    expect(await remainingEquals(second.json().id, rectangle(-75.541, 6.33, -75.54, 6.332))).toBe(true);
    expect((await operationalState(territoryId)).json().progressPercent).toBeCloseTo(75, 0);
  });

  it('keeps remaining area as a MultiPolygon when a session covers part of one part of a two-part territory', async () => {
    const west = rectangle(-75.536, 6.33, -75.534, 6.332);
    const east = rectangle(-75.532, 6.33, -75.53, 6.332);
    const territoryId = await createOpenTerritory('T-coverage-multipart-remaining', {
      type: 'MultiPolygon',
      coordinates: [west.coordinates, east.coordinates]
    });
    const response = await recordSession(territoryId, {
      coveredArea: rectangle(-75.536, 6.33, -75.535, 6.332),
      baseline: 'whole_territory'
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().remainingArea.type).toBe('MultiPolygon');
    expect(response.json().remainingArea.coordinates).toHaveLength(2);
  });

  it('requires an explicit baseline for the first session of a cycle and records nothing without it', async () => {
    const territoryId = await createOpenTerritory('T-coverage-baseline');

    const rejected = await recordSession(territoryId, { coveredArea: WEST_HALF });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ error: 'baseline_required' });
    expect(await countEntries(territoryId)).toBe(0);
    expect((await operationalState(territoryId)).json()).toMatchObject({ state: 'in_progress', progressPercent: null });

    const accepted = await recordSession(territoryId, { coveredArea: WEST_HALF, baseline: 'whole_territory' });
    expect(accepted.statusCode).toBe(201);

    const history = await admin.inject({ method: 'GET', url: `/admin/territories/${territoryId}/audit` });
    const recorded = history.json().events.find((event: { action: string }) => event.action === 'progress_recorded');
    expect(recorded.payload).toMatchObject({ baseline: 'whole_territory', hasCoveredArea: true, cycleNumber: 1 });
  });

  it('refuses a baseline once the cycle already has a remaining area — the baseline is never re-applied', async () => {
    const territoryId = await createOpenTerritory('T-coverage-baseline-twice');
    await recordSession(territoryId, { coveredArea: WEST_HALF, baseline: 'whole_territory' });

    const response = await recordSession(territoryId, { coveredArea: EAST_HALF, baseline: 'whole_territory' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
    expect(response.json().message).toMatch(/baseline/);
    expect(await countEntries(territoryId)).toBe(1);
  });

  it('starts a reopened cycle fresh: the previous cycle remaining area is not reused and a new baseline is required', async () => {
    const territoryId = await createOpenTerritory('T-coverage-reopen');
    await recordSession(territoryId, { coveredArea: WEST_HALF, baseline: 'whole_territory' });
    expect((await changeState(territoryId, { action: 'cycle_completed', effectiveCompletionDate: '2026-09-21' })).statusCode).toBe(201);
    const reopened = await changeState(territoryId, { action: 'reopened', reason: 'new addresses' });
    expect(reopened.json()).toMatchObject({ cycleNumber: 2, remainingArea: null, remainingAreaStatus: 'unknown', progressPercent: null });

    const withoutBaseline = await recordSession(territoryId, { coveredArea: EAST_HALF });
    expect(withoutBaseline.statusCode).toBe(400);
    expect(withoutBaseline.json()).toMatchObject({ error: 'baseline_required' });

    // Cycle 1 left only the east half; cycle 2 starts from the whole
    // territory again, so covering the east half leaves the WEST half.
    const withBaseline = await recordSession(territoryId, { coveredArea: EAST_HALF, baseline: 'whole_territory' });
    expect(withBaseline.statusCode).toBe(201);
    expect(withBaseline.json().cycleNumber).toBe(2);
    expect(await remainingEquals(withBaseline.json().id, WEST_HALF)).toBe(true);

    const entries = (await admin.inject({ method: 'GET', url: `/admin/territories/${territoryId}/progress` })).json().entries;
    expect(entries.map((entry: { cycleNumber: number }) => entry.cycleNumber)).toEqual([1, 2]);
  });

  it('serializes concurrent sessions on the territory lock: each subtracts from the latest remaining area', async () => {
    const territoryId = await createOpenTerritory('T-coverage-concurrent');
    await recordSession(territoryId, { coveredArea: WEST_HALF, baseline: 'whole_territory' });

    const [a, b] = await Promise.all([
      recordSession(territoryId, { coveredArea: NORTH_EAST_QUARTER }),
      recordSession(territoryId, { coveredArea: SOUTH_EAST_QUARTER })
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);

    // Neither session was computed from the stale east-half snapshot: the
    // later one left nothing.
    const status = (await operationalState(territoryId)).json();
    expect(status.progressPercent).toBe(100);
    expect(status.remainingArea).toEqual({ type: 'Polygon', coordinates: [] });
  });

  it('lets exactly one of two concurrent first sessions apply the baseline', async () => {
    const territoryId = await createOpenTerritory('T-coverage-concurrent-baseline');

    const results = await Promise.all([
      recordSession(territoryId, { coveredArea: WEST_HALF, baseline: 'whole_territory' }),
      recordSession(territoryId, { coveredArea: EAST_HALF, baseline: 'whole_territory' })
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([201, 400]);
    expect(await countEntries(territoryId)).toBe(1);
  });

  it('rejects a covered area, pause point, or route outside the territory current revision', async () => {
    const territoryId = await createOpenTerritory('T-coverage-outside');

    const outside = await recordSession(territoryId, { coveredArea: OUTSIDE_TERRITORY, baseline: 'whole_territory' });
    expect(outside.statusCode).toBe(400);
    expect(outside.json()).toMatchObject({ error: 'out_of_bounds' });

    const crossing = await recordSession(territoryId, { coveredArea: CROSSING_BOUNDARY, baseline: 'whole_territory' });
    expect(crossing.statusCode).toBe(400);
    expect(crossing.json()).toMatchObject({ error: 'out_of_bounds' });

    const pause = await recordSession(territoryId, {
      coveredArea: WEST_HALF,
      baseline: 'whole_territory',
      pausePoint: { type: 'Point', coordinates: [-75.58, 6.358] }
    });
    expect(pause.statusCode).toBe(400);
    expect(pause.json()).toMatchObject({ error: 'out_of_bounds' });
    expect(pause.json().message).toMatch(/pause point/);

    const route = await recordSession(territoryId, {
      coveredArea: WEST_HALF,
      baseline: 'whole_territory',
      route: { type: 'LineString', coordinates: [[-75.5738, 6.3575], [-75.58, 6.3585]] }
    });
    expect(route.statusCode).toBe(400);
    expect(route.json()).toMatchObject({ error: 'out_of_bounds' });
    expect(route.json().message).toMatch(/route/);

    expect(await countEntries(territoryId)).toBe(0);
  });

  it('validates containment against the CURRENT revision, not the original one', async () => {
    const territoryId = await createOpenTerritory('T-coverage-revision');
    const revision = await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/revisions`,
      payload: { geometry: WEST_HALF, author: 'admin-1' }
    });
    expect(revision.statusCode).toBe(201);

    const response = await recordSession(territoryId, { coveredArea: EAST_HALF, baseline: 'whole_territory' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'out_of_bounds' });
  });

  describe('5 cm containment tolerance for snapped vertices (2026-10-03)', () => {
    // ~110,636 m per degree of longitude at this latitude (6.358°N).
    const TWO_CM_IN_DEGREES = 0.02 / 110_636;
    const ONE_M_IN_DEGREES = 1 / 110_636;
    // Non-axis-aligned edges, so a point interpolated along an edge is not
    // exactly representable and a strict ST_CoveredBy can flip on float error.
    const IRREGULAR: { type: 'Polygon'; coordinates: number[][][] } = {
      type: 'Polygon',
      coordinates: [[[-75.574, 6.357], [-75.5715, 6.3575], [-75.5722, 6.3595], [-75.5741, 6.3588], [-75.574, 6.357]]]
    };
    const [A, B, C, D] = IRREGULAR.coordinates[0] as [number[], number[], number[], number[]];

    async function storedCoveredEquals(entryId: number, expected: unknown): Promise<boolean> {
      return withClient(async (client) => {
        const { rows } = await client.query<{ equal: boolean }>(
          `SELECT ST_Equals(covered_area, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)) AS equal
           FROM progress_entries WHERE id = $1`,
          [entryId, JSON.stringify(expected)]
        );
        return rows[0]?.equal === true;
      });
    }

    it('accepts a covered area with a vertex 2 cm outside the boundary and stores it exactly as sent (never clipped)', async () => {
      const territoryId = await createOpenTerritory('T-tolerance-2cm');
      const overshoot = {
        type: 'Polygon',
        coordinates: [[[-75.574 - TWO_CM_IN_DEGREES, 6.357], [-75.573, 6.357], [-75.573, 6.359], [-75.574, 6.359], [-75.574 - TWO_CM_IN_DEGREES, 6.357]]]
      };

      const response = await recordSession(territoryId, { coveredArea: overshoot, baseline: 'whole_territory' });
      expect(response.statusCode).toBe(201);
      expect(await storedCoveredEquals(response.json().id, overshoot)).toBe(true);
      // The remaining area is still exactly the territory minus the covered area.
      expect(await remainingEquals(response.json().id, EAST_HALF)).toBe(true);
    });

    it('still rejects a covered area with a vertex 1 m outside the boundary as out_of_bounds', async () => {
      const territoryId = await createOpenTerritory('T-tolerance-1m');
      const tooFar = {
        type: 'Polygon',
        coordinates: [[[-75.574 - ONE_M_IN_DEGREES, 6.357], [-75.573, 6.357], [-75.573, 6.359], [-75.574, 6.359], [-75.574 - ONE_M_IN_DEGREES, 6.357]]]
      };

      const response = await recordSession(territoryId, { coveredArea: tooFar, baseline: 'whole_territory' });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'out_of_bounds' });
      expect(await countEntries(territoryId)).toBe(0);
    });

    it('accepts a covered area whose vertices are exactly boundary vertices', async () => {
      const territoryId = await createOpenTerritory('T-tolerance-boundary-vertices', IRREGULAR);
      const triangle = { type: 'Polygon', coordinates: [[A, B, C, A]] };

      const response = await recordSession(territoryId, { coveredArea: triangle, baseline: 'whole_territory' });
      expect(response.statusCode).toBe(201);
      expect(await remainingEquals(response.json().id, { type: 'Polygon', coordinates: [[A, C, D, A]] })).toBe(true);
    });

    it('accepts a vertex interpolated along a diagonal boundary edge (edge snap)', async () => {
      const territoryId = await createOpenTerritory('T-tolerance-edge-snap', IRREGULAR);
      const t = 0.37;
      const onEdge = [B[0]! + (C[0]! - B[0]!) * t, B[1]! + (C[1]! - B[1]!) * t];
      const covered = { type: 'Polygon', coordinates: [[A, B, onEdge, A]] };

      const response = await recordSession(territoryId, { coveredArea: covered, baseline: 'whole_territory' });
      expect(response.statusCode).toBe(201);
    });

    it("accepts a session snapped to the previous session's border (remaining-area vertices) and leaves nothing", async () => {
      const territoryId = await createOpenTerritory('T-tolerance-remaining-snap', IRREGULAR);
      const first = await recordSession(territoryId, {
        coveredArea: { type: 'Polygon', coordinates: [[A, B, C, A]] },
        baseline: 'whole_territory'
      });
      expect(first.statusCode).toBe(201);

      // Second session drawn on the remaining area's own vertices (A, C, D).
      const second = await recordSession(territoryId, { coveredArea: { type: 'Polygon', coordinates: [[A, C, D, A]] } });
      expect(second.statusCode).toBe(201);
      expect(second.json().remainingArea).toEqual({ type: 'Polygon', coordinates: [] });
      expect((await operationalState(territoryId)).json().progressPercent).toBe(100);
    });
  });

  it('rejects a covered area that does not intersect the current remaining area', async () => {
    const territoryId = await createOpenTerritory('T-coverage-no-overlap');
    await recordSession(territoryId, { coveredArea: WEST_HALF, baseline: 'whole_territory' });

    const response = await recordSession(territoryId, { coveredArea: rectangle(-75.574, 6.357, -75.5735, 6.358) });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'covered_area_not_remaining' });
    expect(response.json().message).toMatch(/does not overlap the remaining area/);
    expect(await countEntries(territoryId)).toBe(1);
  });

  it('stores full coverage as an explicit EMPTY remaining area (0% left), never NULL/unknown', async () => {
    const territoryId = await createOpenTerritory('T-coverage-full');
    await recordSession(territoryId, { coveredArea: WEST_HALF, baseline: 'whole_territory' });

    const full = await recordSession(territoryId, { coveredArea: EAST_HALF });
    expect(full.statusCode).toBe(201);
    expect(full.json()).toMatchObject({
      remainingArea: { type: 'Polygon', coordinates: [] },
      remainingAreaStatus: 'recorded'
    });

    const stored = await withClient(async (client) => {
      const { rows } = await client.query<{ is_null: boolean; is_empty: boolean }>(
        `SELECT remaining_area IS NULL AS is_null, ST_IsEmpty(remaining_area) AS is_empty FROM progress_entries WHERE id = $1`,
        [full.json().id]
      );
      return rows[0];
    });
    expect(stored).toEqual({ is_null: false, is_empty: true });

    const status = (await operationalState(territoryId)).json();
    expect(status).toMatchObject({ remainingAreaStatus: 'recorded', progressPercent: 100 });

    // Nothing is left to cover in this cycle.
    const more = await recordSession(territoryId, { coveredArea: EAST_HALF });
    expect(more.statusCode).toBe(400);
    expect(more.json()).toMatchObject({ error: 'covered_area_not_remaining' });
  });

  it('computes 100% when the first session covers the whole territory', async () => {
    const territoryId = await createOpenTerritory('T-coverage-whole-at-once');
    const response = await recordSession(territoryId, { coveredArea: VALID_SQUARE, baseline: 'whole_territory' });
    expect(response.statusCode).toBe(201);
    expect((await operationalState(territoryId)).json().progressPercent).toBe(100);
  });

  it('continues from a legacy remaining-area-only entry recorded before coverage sessions existed', async () => {
    const territoryId = await createTerritory('T-coverage-legacy');
    await changeState(territoryId, { action: 'in_progress' });
    await withClient((client) =>
      client.query(
        `INSERT INTO progress_entries (territory_id, recorded_by, remaining_area)
         VALUES ($1, 'legacy', ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))`,
        [territoryId, JSON.stringify(EAST_HALF)]
      )
    );
    expect((await operationalState(territoryId)).json().progressPercent).toBeCloseTo(50, 0);

    const response = await recordSession(territoryId, { coveredArea: NORTH_EAST_QUARTER });
    expect(response.statusCode).toBe(201);
    expect(await remainingEquals(response.json().id, SOUTH_EAST_QUARTER)).toBe(true);
  });

  it('keeps the database as the last line of defense for the empty-remaining marker', async () => {
    const territoryId = await createTerritory('T-coverage-db-guard');
    // An empty remaining area without the covered area that proves it.
    await expect(
      withClient((client) =>
        client.query(
          `INSERT INTO progress_entries (territory_id, recorded_by, remaining_area)
           VALUES ($1, 'raw', ST_GeomFromText('POLYGON EMPTY', 4326))`,
          [territoryId]
        )
      )
    ).rejects.toThrow(/progress_entries_remaining_area_valid/);
    // A covered area without any remaining area (unknown result) is not allowed either.
    await expect(
      withClient((client) =>
        client.query(
          `INSERT INTO progress_entries (territory_id, recorded_by, covered_area)
           VALUES ($1, 'raw', ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))`,
          [territoryId, JSON.stringify(WEST_HALF)]
        )
      )
    ).rejects.toThrow(/progress_entries_covered_area_has_remaining/);
  });
});

describe('GET /admin/territories/:id/progress', () => {
  it('lists progress entries for a territory in chronological order, with each covered area', async () => {
    const territoryId = await createOpenTerritory('T-progress-list');
    await recordSession(territoryId, { note: 'first', coveredArea: WEST_HALF, baseline: 'whole_territory' });
    await recordSession(territoryId, { note: 'second', coveredArea: EAST_HALF });

    const response = await admin.inject({ method: 'GET', url: `/admin/territories/${territoryId}/progress` });
    expect(response.statusCode).toBe(200);
    const { entries } = response.json();
    expect(entries.map((e: { note: string }) => e.note)).toEqual(['first', 'second']);
    expect(entries.map((e: { coveredArea: unknown }) => e.coveredArea)).toEqual([WEST_HALF, EAST_HALF]);
  });

  it('returns territory_not_found for a nonexistent territory', async () => {
    const response = await admin.inject({ method: 'GET', url: '/admin/territories/999999/progress' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'territory_not_found' });
  });
});

describe('administrator-controlled operational cycles', () => {
  it('derives immutable cycle state, preserves the effective completion date, and resets pending coverage on reopening', async () => {
    const territoryId = await createTerritory('T-operational-cycle');

    const initially = await operationalState(territoryId);
    expect(initially.statusCode).toBe(200);
    expect(initially.json()).toMatchObject({ state: 'no_record', cycleNumber: null, remainingAreaStatus: 'unknown', progressPercent: null });

    const open = await changeState(territoryId, { action: 'in_progress' });
    expect(open.statusCode).toBe(201);
    expect(open.json().state).toBe('in_progress');

    const coverage = await recordSession(territoryId, { coveredArea: WEST_HALF, baseline: 'whole_territory' });
    expect(coverage.statusCode).toBe(201);

    const paused = await changeState(territoryId, { action: 'paused' });
    expect(paused.statusCode).toBe(201);
    expect(paused.json()).toMatchObject({ state: 'paused', remainingArea: coverage.json().remainingArea, remainingAreaStatus: 'recorded' });

    const completed = await changeState(territoryId, { action: 'cycle_completed', effectiveCompletionDate: '2026-09-21' });
    expect(completed.statusCode).toBe(201);
    expect(completed.json()).toMatchObject({ state: 'cycle_completed', effectiveCompletionDate: '2026-09-21' });

    const reopened = await changeState(territoryId, { action: 'reopened', reason: 'new addresses need coverage' });
    expect(reopened.statusCode).toBe(201);
    expect(reopened.json()).toMatchObject({ state: 'reopened', cycleNumber: 2, remainingArea: null, remainingAreaStatus: 'unknown' });

    await expect(
      withClient((client) => client.query(`UPDATE territory_operational_events SET reason = 'tampered' WHERE territory_id = $1`, [territoryId]))
    ).rejects.toThrow(/append-only/);

    const history = await admin.inject({ method: 'GET', url: `/admin/territories/${territoryId}/audit` });
    expect(history.json().events.map((event: { action: string }) => event.action)).toEqual([
      'created', 'operational_in_progress', 'progress_recorded', 'operational_paused', 'operational_cycle_completed', 'operational_reopened'
    ]);
  });

  it('rejects progress after completion until an administrator explicitly reopens the cycle', async () => {
    const territoryId = await createTerritory('T-operational-completed');
    await changeState(territoryId, { action: 'in_progress' });
    await changeState(territoryId, { action: 'cycle_completed', effectiveCompletionDate: '2026-09-21' });
    const response = await recordSession(territoryId, { coveredArea: WEST_HALF, baseline: 'whole_territory', route: ROUTE });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'territory_not_open' });
    expect(await countEntries(territoryId)).toBe(0);
  });

  it('rejects progress on a territory that was never opened — recording no longer opens a cycle implicitly', async () => {
    const territoryId = await createTerritory('T-operational-never-opened');

    const response = await recordSession(territoryId, { coveredArea: WEST_HALF, baseline: 'whole_territory' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'territory_not_open' });
    expect(await countEntries(territoryId)).toBe(0);
    expect((await operationalState(territoryId)).json()).toMatchObject({ state: 'no_record', cycleNumber: null });

    const history = await admin.inject({ method: 'GET', url: `/admin/territories/${territoryId}/audit` });
    expect(history.json().events.map((event: { action: string }) => event.action)).toEqual(['created']);
  });

  it('still accepts progress on a legacy paused cycle — paused counts as open', async () => {
    const territoryId = await createOpenTerritory('T-operational-paused');
    expect((await changeState(territoryId, { action: 'paused' })).statusCode).toBe(201);

    const response = await recordSession(territoryId, { coveredArea: WEST_HALF, baseline: 'whole_territory' });
    expect(response.statusCode).toBe(201);
    expect(response.json().cycleNumber).toBe(1);
  });

  it('reopens without a reason: the reason is optional and stored as null, and the transition is still audited', async () => {
    const territoryId = await createOpenTerritory('T-operational-reopen-no-reason');
    await changeState(territoryId, { action: 'cycle_completed', effectiveCompletionDate: '2026-10-03' });

    const reopened = await changeState(territoryId, { action: 'reopened' });
    expect(reopened.statusCode).toBe(201);
    expect(reopened.json()).toMatchObject({ state: 'reopened', cycleNumber: 2 });

    const stored = await withClient(async (client) => {
      const { rows } = await client.query<{ reason: string | null }>(
        `SELECT reason FROM territory_operational_events WHERE territory_id = $1 AND action = 'reopened'`,
        [territoryId]
      );
      return rows;
    });
    expect(stored).toEqual([{ reason: null }]);

    const history = await admin.inject({ method: 'GET', url: `/admin/territories/${territoryId}/audit` });
    expect(history.json().events.map((event: { action: string }) => event.action)).toContain('operational_reopened');
  });
});

describe('GET /admin/territories/:id/cycles', () => {
  function listCycles(territoryId: number) {
    return admin.inject({ method: 'GET', url: `/admin/territories/${territoryId}/cycles` });
  }

  async function eventTimes(territoryId: number): Promise<Array<{ action: string; created_at: Date }>> {
    return withClient(async (client) => {
      const { rows } = await client.query<{ action: string; created_at: Date }>(
        'SELECT action, created_at FROM territory_operational_events WHERE territory_id = $1 ORDER BY id',
        [territoryId]
      );
      return rows;
    });
  }

  it('returns an empty list for a territory that was never opened', async () => {
    const territoryId = await createTerritory('T-cycles-none');
    const response = await listCycles(territoryId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ cycles: [] });
  });

  it('returns one open cycle with its opening timestamp and session count', async () => {
    const territoryId = await createOpenTerritory('T-cycles-open');
    expect((await recordSession(territoryId, { coveredArea: WEST_HALF, baseline: 'whole_territory' })).statusCode).toBe(201);

    const [opened] = await eventTimes(territoryId);
    const response = await listCycles(territoryId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      cycles: [
        {
          cycleNumber: 1,
          openedAt: opened!.created_at.toISOString(),
          closedAt: null,
          effectiveCompletionDate: null,
          sessionCount: 1
        }
      ]
    });
  });

  it('lists a closed and a reopened cycle newest first, with each cycle’s dates and its own session count', async () => {
    const territoryId = await createOpenTerritory('T-cycles-two');
    expect((await recordSession(territoryId, { coveredArea: WEST_HALF, baseline: 'whole_territory' })).statusCode).toBe(201);
    expect((await recordSession(territoryId, { coveredArea: NORTH_EAST_QUARTER })).statusCode).toBe(201);
    expect((await changeState(territoryId, { action: 'paused' })).statusCode).toBe(201);
    expect((await changeState(territoryId, { action: 'cycle_completed', effectiveCompletionDate: '2026-10-10' })).statusCode).toBe(201);
    expect((await changeState(territoryId, { action: 'reopened' })).statusCode).toBe(201);
    expect((await recordSession(territoryId, { coveredArea: EAST_HALF, baseline: 'whole_territory' })).statusCode).toBe(201);

    const events = await eventTimes(territoryId);
    const opened1 = events.find((event) => event.action === 'in_progress')!.created_at;
    const closed1 = events.find((event) => event.action === 'cycle_completed')!.created_at;
    const opened2 = events.find((event) => event.action === 'reopened')!.created_at;

    const response = await listCycles(territoryId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      cycles: [
        {
          cycleNumber: 2,
          openedAt: opened2.toISOString(),
          closedAt: null,
          effectiveCompletionDate: null,
          sessionCount: 1
        },
        {
          cycleNumber: 1,
          openedAt: opened1.toISOString(),
          closedAt: closed1.toISOString(),
          effectiveCompletionDate: '2026-10-10',
          sessionCount: 2
        }
      ]
    });
  });

  it('counts zero sessions for a cycle closed without any recorded progress and ignores legacy entries before the first cycle', async () => {
    const territoryId = await createTerritory('T-cycles-empty-closed');
    await withClient((client) =>
      client.query(
        `INSERT INTO progress_entries (territory_id, recorded_by, recorded_at)
         VALUES ($1, 'legacy', now() - interval '1 day')`,
        [territoryId]
      )
    );
    await openTerritory(territoryId);
    expect((await changeState(territoryId, { action: 'cycle_completed', effectiveCompletionDate: '2026-10-03' })).statusCode).toBe(201);

    const response = await listCycles(territoryId);
    expect(response.json().cycles).toHaveLength(1);
    expect(response.json().cycles[0]).toMatchObject({ cycleNumber: 1, sessionCount: 0, effectiveCompletionDate: '2026-10-03' });
    expect(response.json().cycles[0].closedAt).not.toBeNull();
  });

  it('returns territory_not_found for a nonexistent territory', async () => {
    const response = await listCycles(999999);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'territory_not_found' });
  });
});

describe('GET /admin/territories/:id/audit', () => {
  it('exposes the full chronological history for a territory: creation, sharing, progress, and new revisions', async () => {
    const territoryId = await createTerritory('T-audit-01');
    await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/share-tokens`,
      payload: { createdBy: 'admin-1' }
    });
    await openTerritory(territoryId);
    await recordSession(territoryId, { recordedBy: 'worker-1', note: 'halfway done', coveredArea: WEST_HALF, baseline: 'whole_territory' });
    await admin.inject({
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

    const response = await admin.inject({ method: 'GET', url: `/admin/territories/${territoryId}/audit` });
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
    const response = await admin.inject({ method: 'GET', url: '/admin/territories/999999/audit' });
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
    const territoryB = await createOpenTerritory('T-audit-isolation-B', DISTINCT_SQUARE);
    const recorded = await recordSession(territoryB, {
      recordedBy: 'worker-1',
      note: 'B only',
      coveredArea: DISTINCT_SQUARE,
      baseline: 'whole_territory'
    });
    expect(recorded.statusCode).toBe(201);

    const response = await admin.inject({ method: 'GET', url: `/admin/territories/${territoryA}/audit` });
    const events = response.json().events as Array<{ entityId: number; reason: string }>;

    expect(events.every((e) => e.entityId === territoryA)).toBe(true);
    expect(events.some((e) => e.reason === 'B only')).toBe(false);
  });
});
