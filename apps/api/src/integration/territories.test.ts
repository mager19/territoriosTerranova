/**
 * Full-stack integration tests for slice 1 (territory + revisions) against
 * real PostGIS via Testcontainers, exercised through the actual HTTP routes
 * (app.inject), not by calling domain functions directly — this proves the
 * route layer's error-to-status mapping, not just the domain layer.
 *
 * Geometry fixtures mirror packages/geo/src/integration/db.test.ts exactly
 * (same coordinates, same fixture boundary envelope) so both suites reason
 * about the same known-good/known-bad shapes.
 *
 * `boundary_reference_missing` is deliberately NOT re-proven at the HTTP
 * level here: the underlying trigger is already integration-proven in A2's
 * suite ("fails closed when the boundary reference is not loaded"), and
 * this suite's own db/pg-error-mapper.test.ts unit-proves the translation
 * of that trigger's message into BoundaryReferenceMissingError. Standing up
 * a second, boundary-less container just to re-walk that path end to end
 * would duplicate coverage without adding signal.
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
// A simple 4-point bowtie (swapping two adjacent corners of a valid
// quadrilateral) ALWAYS nets to zero signed area — its two triangular lobes
// have equal size and opposite winding, so they cancel exactly (verified
// against PostGIS directly: ST_Area = 0 for every 4-point bowtie tried).
// That makes it indistinguishable from COLLINEAR below at the CHECK-CHECK
// boundary, since it then violates BOTH geom_valid and geom_has_area and
// Postgres's constraint evaluation order is not something to depend on.
// This 6-point self-intersecting hexagon (one big lobe, one small lobe,
// same winding) is invalid for the SAME reason (self-intersection) but
// nets a clearly nonzero area, so it isolates the geom_valid constraint
// specifically. Verified: ST_IsValid=false, reason "Self-intersection",
// ST_Area=0.00015999999999998784.
const SELF_INTERSECTING = {
  type: 'Polygon',
  coordinates: [
    [
      [-75.58, 6.35],
      [-75.56, 6.35],
      [-75.57, 6.365],
      [-75.572, 6.36],
      [-75.568, 6.36],
      [-75.57, 6.365],
      [-75.58, 6.35]
    ]
  ]
};
const COLLINEAR = {
  type: 'Polygon',
  coordinates: [
    [
      [-75.574, 6.357],
      [-75.573, 6.358],
      [-75.572, 6.359],
      [-75.574, 6.357]
    ]
  ]
};
const OVERLAP_A = {
  type: 'Polygon',
  coordinates: [
    [
      [-75.58, 6.35],
      [-75.574, 6.35],
      [-75.574, 6.356],
      [-75.58, 6.356],
      [-75.58, 6.35]
    ]
  ]
};
const OVERLAP_B = {
  type: 'Polygon',
  coordinates: [
    [
      [-75.577, 6.353],
      [-75.571, 6.353],
      [-75.571, 6.359],
      [-75.577, 6.359],
      [-75.577, 6.353]
    ]
  ]
};
const OUTSIDE_BELLO = {
  type: 'Polygon',
  coordinates: [
    [
      [-76.1, 6.9],
      [-76.09, 6.9],
      [-76.09, 6.91],
      [-76.1, 6.91],
      [-76.1, 6.9]
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
    .withDatabase('territorios_api_test')
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
  // Overlap enforcement considers ACTIVE territories only (see A2's
  // migration); archive between tests so each starts from a clean slate.
  await withClient((client) => client.query(`UPDATE territories SET status = 'archived' WHERE status = 'active'`));
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

async function auditEventsFor(entityId: number): Promise<Array<{ action: string; actor: string }>> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ action: string; actor: string }>(
      `SELECT action, actor FROM audit_events WHERE entity_type = 'territory' AND entity_id = $1 ORDER BY created_at`,
      [entityId]
    );
    return rows;
  });
}

describe('POST /admin/territories', () => {
  it('creates a territory with its first revision and an audit event', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: 'T-01', geometry: VALID_SQUARE, author: 'admin-1' }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ name: 'T-01', status: 'active' });
    expect(body.revisions).toHaveLength(1);
    expect(body.revisions[0]).toMatchObject({ revisionNumber: 1, author: 'admin-1' });
    expect(body.revisions[0].geometry.type).toBe('Polygon');

    const events = await auditEventsFor(body.id);
    expect(events).toEqual([{ action: 'created', actor: 'admin-1' }]);
  });

  it.each([
    ['invalid_geometry', 400, SELF_INTERSECTING],
    ['zero_area_geometry', 400, COLLINEAR],
    ['out_of_bounds', 400, OUTSIDE_BELLO]
  ])('rejects a %s geometry with a distinct %i response, never a generic 400', async (code, status, geometry) => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: `T-${code}`, geometry, author: 'admin-1' }
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ error: code });
  });

  it('rejects an unauthorized overlap with a real active territory as a 409, distinct from the other causes', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: 'T-overlap-first', geometry: OVERLAP_A, author: 'admin-1' }
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: 'T-overlap-second', geometry: OVERLAP_B, author: 'admin-1' }
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: 'unauthorized_overlap' });
  });
});

describe('GET /admin/territories and GET /admin/territories/:id', () => {
  it('lists created territories and reads one back with its revision history', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: 'T-list', geometry: VALID_SQUARE, author: 'admin-1' }
    });
    const { id } = created.json();

    const list = await app.inject({ method: 'GET', url: '/admin/territories' });
    expect(list.statusCode).toBe(200);
    expect(list.json().territories.some((t: { id: number }) => t.id === id)).toBe(true);

    const read = await app.inject({ method: 'GET', url: `/admin/territories/${id}` });
    expect(read.statusCode).toBe(200);
    expect(read.json().revisions).toHaveLength(1);
  });

  it('returns a distinct territory_not_found response, not a generic 400/500, for a nonexistent id', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/territories/999999' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'territory_not_found' });
  });
});

describe('POST /admin/territories/:id/revisions', () => {
  it('appends a new revision, leaving the prior revision byte-for-byte unchanged (immutable, never updated)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: 'T-revise', geometry: VALID_SQUARE, author: 'admin-1' }
    });
    const { id, revisions } = created.json();
    const revision1Before = revisions[0];

    const secondGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [-75.5745, 6.3571],
          [-75.5721, 6.3571],
          [-75.5721, 6.3591],
          [-75.5745, 6.3591],
          [-75.5745, 6.3571]
        ]
      ]
    };
    const revised = await app.inject({
      method: 'POST',
      url: `/admin/territories/${id}/revisions`,
      payload: { geometry: secondGeometry, author: 'admin-2' }
    });
    expect(revised.statusCode).toBe(201);
    expect(revised.json()).toMatchObject({ revisionNumber: 2, author: 'admin-2' });

    const read = await app.inject({ method: 'GET', url: `/admin/territories/${id}` });
    const revision1After = read.json().revisions.find((r: { revisionNumber: number }) => r.revisionNumber === 1);
    expect(revision1After).toEqual(revision1Before);
    expect(read.json().revisions).toHaveLength(2);

    const events = await auditEventsFor(id);
    expect(events.map((e) => e.action)).toEqual(['created', 'revision_submitted']);
  });

  it('rejects a real UPDATE against territory_revisions at the database level (immutability, proven directly)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: 'T-immutable', geometry: VALID_SQUARE, author: 'admin-1' }
    });
    const revisionId = created.json().revisions[0].id;

    await expect(
      withClient((client) =>
        client.query(`UPDATE territory_revisions SET author = 'tampered' WHERE id = $1`, [revisionId])
      )
    ).rejects.toThrow(/append-only/);
  });

  it('returns territory_not_found, not a generic error, when submitting to a nonexistent territory', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/territories/999999/revisions',
      payload: { geometry: VALID_SQUARE, author: 'admin-1' }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'territory_not_found' });
  });
});
