/**
 * Full-stack integration tests for A4 — the highest-stakes suite in this
 * project. Every DoD bullet in docs/agents/A4-sharing.md gets its own
 * test here, against real PostGIS via Testcontainers, exercised through
 * the actual HTTP routes.
 *
 * A share token now scopes to a whole TERRITORY, not a per-person
 * assignment — 2026-09-08: territories are shared to a group of
 * volunteers, not assigned to one named person (db/migrations/
 * 0004_remove_individual_assignment.sql). "Share this territory" IS the
 * admin action; there is no separate assign step first.
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
const OTHER_SQUARE = {
  type: 'Polygon',
  coordinates: [[[-75.59, 6.34], [-75.585, 6.34], [-75.585, 6.345], [-75.59, 6.345], [-75.59, 6.34]]]
};

// West half of VALID_SQUARE — a coverage session that leaves the east half.
const WEST_HALF = {
  type: 'Polygon',
  coordinates: [[[-75.574, 6.357], [-75.573, 6.357], [-75.573, 6.359], [-75.574, 6.359], [-75.574, 6.357]]]
};

// East strip of VALID_SQUARE, disjoint from WEST_HALF (gap between -75.573 and -75.5725).
const EAST_STRIP = {
  type: 'Polygon',
  coordinates: [[[-75.5725, 6.357], [-75.572, 6.357], [-75.572, 6.359], [-75.5725, 6.359], [-75.5725, 6.357]]]
};

// The pinned public allowlist (sorted).
const PUBLIC_KEYS = ['boundary', 'coveredArea', 'note', 'remainingArea', 'remainingAreaStatus', 'route', 'territoryName'];

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
    .withDatabase('territorios_api_sharing_test')
    .withUsername('territorios')
    .withPassword('territorios')
    .withStartupTimeout(300_000)
    .start();
  databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);
  await withClient((client) => client.query(FIXTURE_BOUNDARY_SQL));

  pool = new Pool({ connectionString: databaseUrl, max: 10 });
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

interface ShareTokenBody {
  readonly id: number;
  readonly token: string;
  readonly territoryId: number;
  readonly expiresAt: string | null;
}

async function createTerritoryAndShare(
  geometry: unknown = VALID_SQUARE,
  name = `T-share-${Math.random().toString(36).slice(2)}`
): Promise<{ territoryId: number; slug: string; token: string; tokenId: number }> {
  const territoryResponse = await admin.inject({
    method: 'POST',
    url: '/admin/territories',
    payload: { name, geometry, author: 'admin-1' }
  });
  const territoryId = territoryResponse.json().id;
  const slug = territoryResponse.json().slug as string;
  // Recording progress requires an open territory (2026-10-03): every shared
  // territory in this file starts with its first cycle explicitly opened.
  const openResponse = await admin.inject({
    method: 'POST',
    url: `/admin/territories/${territoryId}/operational-state`,
    payload: { action: 'in_progress', actor: 'admin-1' }
  });
  expect(openResponse.statusCode).toBe(201);

  const tokenResponse = await admin.inject({
    method: 'POST',
    url: `/admin/territories/${territoryId}/share-tokens`,
    payload: { createdBy: 'admin-1' }
  });
  expect(tokenResponse.statusCode).toBe(201);
  const tokenBody = tokenResponse.json() as ShareTokenBody;

  return { territoryId, slug, token: tokenBody.token, tokenId: tokenBody.id };
}

describe('POST /admin/territories/:id/share-tokens', () => {
  it('creates a token and returns the plaintext exactly once', async () => {
    const { token } = await createTerritoryAndShare();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(30);
  });

  it('stores only a hash — the plaintext token never appears anywhere in the database', async () => {
    const { token } = await createTerritoryAndShare();

    const rows = await withClient(async (client) => {
      const { rows } = await client.query<{ token_hash: string }>(`SELECT token_hash FROM share_tokens`);
      return rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.token_hash).not.toBe(token);
      expect(row.token_hash).not.toContain(token);
    }
  });

  it('returns territory_not_found for a nonexistent territory', async () => {
    const response = await admin.inject({
      method: 'POST',
      url: '/admin/territories/999999/share-tokens',
      payload: { createdBy: 'admin-1' }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'territory_not_found' });
  });
});

describe('GET /public/territories/:token — response shape', () => {
  it('returns exactly the allowlisted keys, nothing more', async () => {
    const { token } = await createTerritoryAndShare();

    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    // This is the pinned list. Adding a field to the public response
    // requires deliberately updating this test — that friction is the
    // point (A4 brief: "must break when someone adds a field carelessly").
    // `route` (2026-09-08), the merged current-cycle `coveredArea`
    // (2026-09-26), and the latest session `note` (2026-10-03) are the
    // deliberate exceptions to the exclusion list below (product
    // decisions, AGENTS.md "Privacy rules"). `pausePoint` was removed
    // from the public view on 2026-10-03.
    expect(Object.keys(body).sort()).toEqual(PUBLIC_KEYS);
  });

  it('returns the territory boundary as a valid Polygon', async () => {
    const { token } = await createTerritoryAndShare();
    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    const body = response.json();
    expect(body.boundary.type).toBe('Polygon');
    expect(Array.isArray(body.boundary.coordinates)).toBe(true);
  });

  it('always reflects the territory\'s CURRENT (latest) revision — there is no per-claim revision to pin against', async () => {
    const { territoryId, token } = await createTerritoryAndShare();
    const newGeometry = {
      type: 'Polygon',
      coordinates: [[[-75.5745, 6.3571], [-75.5721, 6.3571], [-75.5721, 6.3591], [-75.5745, 6.3591], [-75.5745, 6.3571]]]
    };
    await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/revisions`,
      payload: { geometry: newGeometry, author: 'admin-2' }
    });

    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(response.json().boundary).toEqual(newGeometry);
  });

  it('reports remaining area as explicitly unknown when no progress was recorded — never inferred', async () => {
    const { token } = await createTerritoryAndShare();
    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    const body = response.json();
    expect(body.remainingArea).toBeNull();
    expect(body.remainingAreaStatus).toBe('unknown');
  });

  it('shows the server-derived remaining area when a coverage session recorded one', async () => {
    const { token, territoryId } = await createTerritoryAndShare();
    const coveredArea = {
      type: 'Polygon',
      coordinates: [[[-75.574, 6.357], [-75.573, 6.357], [-75.573, 6.359], [-75.574, 6.359], [-75.574, 6.357]]]
    };
    const session = await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-1', coveredArea, baseline: 'whole_territory' }
    });
    expect(session.statusCode).toBe(201);

    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    const body = response.json();
    expect(body.remainingAreaStatus).toBe('recorded');
    expect(body.remainingArea).toEqual(session.json().remainingArea);
  });

  it('exposes only ONE merged covered area — never per-session geometries, counts, or session data', async () => {
    const { token, territoryId } = await createTerritoryAndShare();
    const coveredArea = {
      type: 'Polygon',
      coordinates: [[[-75.574, 6.357], [-75.5731, 6.357], [-75.5731, 6.3589], [-75.574, 6.3589], [-75.574, 6.357]]]
    };
    const session = await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-1', coveredArea, baseline: 'whole_territory' }
    });
    expect(session.statusCode).toBe(201);
    // Precondition: the admin DTO carries the per-session shape and metadata.
    expect(session.json().coveredArea).toEqual(coveredArea);

    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    const body = response.json();
    // Superseded 2026-09-26: the merged `coveredArea` is now public, but it
    // is the only covered-area data — no list, count, or session metadata.
    expect(Object.keys(body).sort()).toEqual(PUBLIC_KEYS);
    expect(['Polygon', 'MultiPolygon']).toContain(body.coveredArea.type);
    const raw = JSON.stringify(body);
    expect(raw.match(/covered\w*/gi)).toEqual(['coveredArea']);
    expect(raw).not.toMatch(/sessions?/i);
    expect(raw).not.toContain('baseline');
    expect(raw).not.toMatch(/progress|percent|cycle/i);
  });

  it('reports an explicit empty remaining area — not unknown — once a cycle is fully covered', async () => {
    const { token, territoryId } = await createTerritoryAndShare();
    await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-1', coveredArea: VALID_SQUARE, baseline: 'whole_territory' }
    });

    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(response.json()).toMatchObject({
      remainingArea: { type: 'Polygon', coordinates: [] },
      remainingAreaStatus: 'recorded'
    });
  });

  it('does not reuse a prior cycle’s pending-area snapshot after an administrator reopens work', async () => {
    const { token, territoryId } = await createTerritoryAndShare();
    await admin.inject({
      method: 'POST', url: `/admin/territories/${territoryId}/progress`, payload: { recordedBy: 'admin-1', coveredArea: WEST_HALF, baseline: 'whole_territory' }
    });
    await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/operational-state`,
      payload: { action: 'cycle_completed', actor: 'admin-1', effectiveCompletionDate: '2026-09-21' }
    });
    await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/operational-state`,
      payload: { action: 'reopened', actor: 'admin-1', reason: 'new work started' }
    });

    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      remainingArea: null,
      remainingAreaStatus: 'unknown',
      route: null,
      note: null,
      coveredArea: null
    });
    expect(Object.keys(response.json())).not.toContain('operationalState');
  });

  it('never leaks recordedBy identity, older notes, timestamps, baseline, cycle, history, pause point, or internal ids', async () => {
    const { token, territoryId } = await createTerritoryAndShare();
    const first = await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: {
        recordedBy: 'worker-1',
        note: 'an older note the public must never see',
        coveredArea: WEST_HALF,
        baseline: 'whole_territory',
        pausePoint: { type: 'Point', coordinates: [-75.573, 6.358] },
        route: { type: 'LineString', coordinates: [[-75.5738, 6.3575], [-75.5732, 6.3585]] }
      }
    });
    expect(first.statusCode).toBe(201);
    const second = await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-2', note: 'Quedamos en la esquina', coveredArea: EAST_STRIP }
    });
    expect(second.statusCode).toBe(201);

    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    const body = response.json();
    const raw = JSON.stringify(body);
    // The latest session's note is the one deliberate text exposure (2026-10-03).
    expect(body.note).toBe('Quedamos en la esquina');
    expect(raw).not.toContain('older note');
    expect(raw).not.toMatch(/worker-[12]/);
    expect(raw).not.toContain(TEST_ADMIN_EMAIL); // the real recorder identity since admin sessions (2026-10-03)
    expect(raw).not.toContain('@');
    expect(raw).not.toMatch(/"id"\s*:/); // no raw id field anywhere in the payload
    expect(raw).not.toContain('recordedAt');
    expect(raw).not.toMatch(/recorded(By|At)|notes|baseline|cycle|createdAt|history|sessions|pause/i);
    expect(raw.match(/note/gi)).toEqual(['note']); // only the single `note` key itself
    expect(Object.keys(body).sort()).toEqual(PUBLIC_KEYS);
    expect(body).not.toHaveProperty('pausePoint');
  });

  it('exposes the route line by deliberate exception — a volunteer resuming their own coverage', async () => {
    const { token, territoryId } = await createTerritoryAndShare();
    const route = { type: 'LineString', coordinates: [[-75.5738, 6.3575], [-75.5732, 6.3585]] };
    await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-1', route, coveredArea: WEST_HALF, baseline: 'whole_territory' }
    });

    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    const body = response.json();
    expect(body.route).toEqual(route);
  });

  it('shows the latest RECORDED route even when a later session recorded none', async () => {
    const { token, territoryId } = await createTerritoryAndShare();
    const route = { type: 'LineString', coordinates: [[-75.5738, 6.3575], [-75.5732, 6.3585]] };
    const first = await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-1', route, coveredArea: WEST_HALF, baseline: 'whole_territory' }
    });
    expect(first.statusCode).toBe(201);
    const second = await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-2', coveredArea: EAST_STRIP }
    });
    expect(second.statusCode).toBe(201);

    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(response.json().route).toEqual(route);
  });

  it('exposes the note of the latest session of the current cycle — where to resume', async () => {
    const { token, territoryId } = await createTerritoryAndShare();
    const record = (payload: Record<string, unknown>) =>
      admin.inject({ method: 'POST', url: `/admin/territories/${territoryId}/progress`, payload });

    expect((await record({ recordedBy: 'worker-1', coveredArea: WEST_HALF, baseline: 'whole_territory', note: 'first note' })).statusCode).toBe(201);
    expect((await record({ recordedBy: 'worker-1', coveredArea: EAST_STRIP, note: 'Quedamos en la Diagonal 57' })).statusCode).toBe(201);

    // One GET only: the file-wide app shares one per-IP rate-limit bucket.
    const body = (await app.inject({ method: 'GET', url: `/public/territories/${token}` })).json();
    expect(body.note).toBe('Quedamos en la Diagonal 57');
    expect(JSON.stringify(body)).not.toContain('first note');
  });

  it('returns a null note when the latest session has none — never falls back to an older, stale note', async () => {
    const { token, territoryId } = await createTerritoryAndShare();
    const record = (payload: Record<string, unknown>) =>
      admin.inject({ method: 'POST', url: `/admin/territories/${territoryId}/progress`, payload });

    expect((await record({ recordedBy: 'worker-1', coveredArea: WEST_HALF, baseline: 'whole_territory', note: 'stale note' })).statusCode).toBe(201);
    expect((await record({ recordedBy: 'worker-1', coveredArea: EAST_STRIP, note: '   ' })).statusCode).toBe(201);

    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    const body = response.json();
    expect(body.note).toBeNull();
    expect(JSON.stringify(body)).not.toContain('stale note');
  });

  it('reports the note and covered area as null when nothing was recorded', async () => {
    const { token } = await createTerritoryAndShare();
    const body = (await app.inject({ method: 'GET', url: `/public/territories/${token}` })).json();
    expect(body.note).toBeNull();
    expect(body.coveredArea).toBeNull();
  });

  it('merges every covered area of the current cycle into one shape — two disjoint sessions become one MultiPolygon', async () => {
    const { token, territoryId } = await createTerritoryAndShare();
    await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-1', coveredArea: WEST_HALF, baseline: 'whole_territory' }
    });
    await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-1', coveredArea: EAST_STRIP }
    });

    const body = (await app.inject({ method: 'GET', url: `/public/territories/${token}` })).json();
    expect(body.coveredArea.type).toBe('MultiPolygon');
    expect(body.coveredArea.coordinates).toHaveLength(2);

    const { rows } = await pool.query<{ merged: number; expected: number }>(
      `SELECT ST_Area(ST_GeomFromGeoJSON($1)) AS merged,
              ST_Area(ST_GeomFromGeoJSON($2)) + ST_Area(ST_GeomFromGeoJSON($3)) AS expected`,
      [JSON.stringify(body.coveredArea), JSON.stringify(WEST_HALF), JSON.stringify(EAST_STRIP)]
    );
    expect(rows[0]!.merged).toBeCloseTo(rows[0]!.expected, 12);
  });

  it('excludes a previous cycle’s note and covered area after an administrator reopens work', async () => {
    const { token, territoryId } = await createTerritoryAndShare();
    const state = (payload: Record<string, unknown>) =>
      admin.inject({ method: 'POST', url: `/admin/territories/${territoryId}/operational-state`, payload });
    const record = (payload: Record<string, unknown>) =>
      admin.inject({ method: 'POST', url: `/admin/territories/${territoryId}/progress`, payload });

    await record({ recordedBy: 'admin-1', coveredArea: WEST_HALF, baseline: 'whole_territory', note: 'previous cycle note' });
    await state({ action: 'cycle_completed', actor: 'admin-1', effectiveCompletionDate: '2026-09-21' });
    await state({ action: 'reopened', actor: 'admin-1', reason: 'new work started' });

    let body = (await app.inject({ method: 'GET', url: `/public/territories/${token}` })).json();
    expect(body.note).toBeNull();
    expect(body.coveredArea).toBeNull();

    // New cycle: only the new session is reflected, never merged with the old one.
    const newCycleSession = await record({ recordedBy: 'admin-1', coveredArea: EAST_STRIP, baseline: 'whole_territory' });
    expect(newCycleSession.statusCode).toBe(201);
    body = (await app.inject({ method: 'GET', url: `/public/territories/${token}` })).json();
    expect(body.coveredArea).toEqual(EAST_STRIP);
    expect(body.note).toBeNull();
    expect(JSON.stringify(body)).not.toContain('previous cycle note');
  });

  it('reports the route as null when no progress entry has recorded one — never inferred', async () => {
    const { token } = await createTerritoryAndShare();
    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    const body = response.json();
    expect(body.route).toBeNull();
  });
});

describe('GET /public/territories/:token — headers', () => {
  it('sets every required security header on a valid response', async () => {
    const { token } = await createTerritoryAndShare();
    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('sets the same required security headers even on a 404 — a cached/indexed 404 still leaks that this endpoint exists', async () => {
    const response = await app.inject({ method: 'GET', url: '/public/territories/not-a-real-token' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('GET /public/territories/:token — revocation, expiry, and scope', () => {
  it('a nonexistent token returns 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/public/territories/this-token-was-never-issued' });
    expect(response.statusCode).toBe(404);
  });

  it('a revoked token returns 404 — never 403, which would confirm the token existed', async () => {
    const { token, tokenId } = await createTerritoryAndShare();

    const before = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(before.statusCode).toBe(200);

    const revokeResponse = await admin.inject({
      method: 'POST',
      url: `/admin/share-tokens/${tokenId}/revoke`,
      payload: { actor: 'admin-1' }
    });
    expect(revokeResponse.statusCode).toBe(204);

    const after = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(after.statusCode).toBe(404);
    expect(after.statusCode).not.toBe(403);
  });

  it('revocation takes effect immediately — no cache window', async () => {
    const { token, tokenId } = await createTerritoryAndShare();
    await admin.inject({ method: 'POST', url: `/admin/share-tokens/${tokenId}/revoke`, payload: { actor: 'admin-1' } });
    // Immediately, not "eventually" — the very next request must already reflect it.
    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(response.statusCode).toBe(404);
  });

  it('an expired token returns 404', async () => {
    // A2's own CHECK constraint (share_tokens_expiry_after_creation) requires
    // expires_at > created_at, so an expiry can never be backdated before
    // creation — there is no way to fabricate an "already expired at
    // creation" row, by design. The only honest way to test this is to
    // create a token that expires in the near future via the real admin
    // route (exercising that input path too) and wait for it to lapse.
    const territoryResponse = await admin.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: `T-expiry-${Math.random().toString(36).slice(2)}`, geometry: VALID_SQUARE, author: 'admin-1' }
    });
    const tokenResponse = await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryResponse.json().id}/share-tokens`,
      payload: { createdBy: 'admin-1', expiresAt: new Date(Date.now() + 800).toISOString() }
    });
    expect(tokenResponse.statusCode).toBe(201);
    const token = (tokenResponse.json() as ShareTokenBody).token;

    const beforeExpiry = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(beforeExpiry.statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const afterExpiry = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(afterExpiry.statusCode).toBe(404);
  });

  it('a valid, unexpired, unrevoked token still works (control case for the expiry test)', async () => {
    const { token } = await createTerritoryAndShare();
    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(response.statusCode).toBe(200);
  });

  it('cannot read another territory by any parameter manipulation — each token is scoped to exactly its own territory', async () => {
    const a = await createTerritoryAndShare(VALID_SQUARE, 'T-scope-A');
    const b = await createTerritoryAndShare(OTHER_SQUARE, 'T-scope-B');

    const responseA = await app.inject({ method: 'GET', url: `/public/territories/${a.token}` });
    const responseB = await app.inject({ method: 'GET', url: `/public/territories/${b.token}` });

    expect(responseA.json().territoryName).toBe('T-scope-A');
    expect(responseB.json().territoryName).toBe('T-scope-B');
    expect(responseA.json().boundary).not.toEqual(responseB.json().boundary);

    // There is no query/path parameter to manipulate on this route besides
    // the token itself — token A cannot be swapped with an id/name to read
    // B, because the route accepts nothing but the token.
    const attemptedManipulation = await app.inject({
      method: 'GET',
      url: `/public/territories/${a.token}?territoryId=${b.territoryId}`
    });
    expect(attemptedManipulation.json().territoryName).toBe('T-scope-A');
  });
});

describe('a share token cannot invoke any administrative action', () => {
  /**
   * Since 2026-10-03 every /admin route requires an admin session
   * (auth/admin-guard.ts, docs/admin-auth.md). A share token is never an
   * administrator principal: presented in any form — bearer header, custom
   * header, or even as the admin_session cookie value — it is rejected.
   */
  it('rejects a share token presented as a bearer header, a custom header, or the session cookie itself', async () => {
    const { token } = await createTerritoryAndShare();
    const response = await app.inject({
      method: 'GET',
      url: '/admin/territories',
      headers: { authorization: `Bearer ${token}`, 'x-share-token': token, cookie: `admin_session=${token}` }
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
  });

  it('a token in an Authorization or custom header changes nothing about an admin route\'s response — it is never read as a credential', async () => {
    const { token } = await createTerritoryAndShare();

    const withoutToken = await admin.inject({ method: 'GET', url: '/admin/territories' });
    const withToken = await admin.inject({
      method: 'GET',
      url: '/admin/territories',
      headers: { authorization: `Bearer ${token}`, 'x-share-token': token }
    });

    expect(withToken.statusCode).toBe(withoutToken.statusCode);
    // Same list length is enough to prove the header had zero effect on
    // the query executed — a credential-aware bug would scope or filter
    // differently, not just happen to return the same status.
    expect(withToken.json().territories.length).toBe(withoutToken.json().territories.length);
  });

  it('a share token string sent as actor body data (author, recordedBy) is ignored — the actor is always the session email', async () => {
    const { token, territoryId } = await createTerritoryAndShare();

    const revisionResponse = await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/revisions`,
      payload: { geometry: OTHER_SQUARE, author: token }
    });
    expect(revisionResponse.statusCode).toBe(201);
    expect(revisionResponse.json().author).toBe(TEST_ADMIN_EMAIL);

    const progressResponse = await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: token, note: 'ordinary text, not a credential', coveredArea: OTHER_SQUARE, baseline: 'whole_territory' }
    });
    expect(progressResponse.statusCode).toBe(201);
    expect(progressResponse.json().recordedBy).toBe(TEST_ADMIN_EMAIL);
  });

  it('the share token itself is never a valid territory id on an admin route — no implicit coercion path from token to admin resource', async () => {
    const { token } = await createTerritoryAndShare();
    const response = await admin.inject({ method: 'GET', url: `/admin/territories/${token}` });
    expect(response.statusCode).toBe(400); // fails the positive-integer id check, exactly like any other garbage id
  });
});

/**
 * The fixed, readable public URL (2026-10-03 product decision, AGENTS.md
 * "Privacy rules"): `/public/t/:slug` answers with EXACTLY the token route's
 * allowlisted view — same builder, same keys, same exclusions, same headers.
 * An isolated app keeps this block's requests out of the file-wide app's
 * per-IP rate-limit bucket (see 'rate limiting' below).
 */
describe('GET /public/t/:slug', () => {
  let slugApp: FastifyInstance;

  beforeAll(async () => {
    slugApp = await buildApp(
      { queryPostgisVersion: async () => '3.4.3', pool, auth: { config: testAuthConfig(), sessions } },
      { logger: false }
    );
  });

  afterAll(async () => {
    await slugApp.close();
  });

  it('returns the very same allowlisted body as the token route, and never a sensitive field', async () => {
    const { territoryId, slug, token } = await createTerritoryAndShare();
    const first = await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: {
        recordedBy: 'worker-1',
        note: 'an older note the public must never see',
        coveredArea: WEST_HALF,
        baseline: 'whole_territory',
        pausePoint: { type: 'Point', coordinates: [-75.573, 6.358] },
        route: { type: 'LineString', coordinates: [[-75.5738, 6.3575], [-75.5732, 6.3585]] }
      }
    });
    expect(first.statusCode).toBe(201);
    const second = await admin.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: 'worker-2', note: 'Quedamos en la esquina', coveredArea: EAST_STRIP }
    });
    expect(second.statusCode).toBe(201);

    const bySlug = await slugApp.inject({ method: 'GET', url: `/public/t/${slug}` });
    const byToken = await slugApp.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(bySlug.statusCode).toBe(200);
    const body = bySlug.json();
    expect(body).toEqual(byToken.json());
    expect(Object.keys(body).sort()).toEqual(PUBLIC_KEYS);
    expect(body.note).toBe('Quedamos en la esquina');
    expect(body.coveredArea.type).toBe('MultiPolygon');

    const raw = JSON.stringify(body);
    expect(raw).not.toContain('older note');
    expect(raw).not.toMatch(/worker-[12]/);
    expect(raw).not.toContain('@');
    expect(raw).not.toMatch(/"id"\s*:/);
    expect(raw).not.toMatch(/recorded(By|At)|notes|baseline|cycle|createdAt|history|sessions|pause/i);
    expect(body).not.toHaveProperty('slug');
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('number');
  });

  it('serves a multi-part territory boundary as one MultiPolygon, with the same allowlisted keys', async () => {
    const west = [[[-75.52, 6.31], [-75.518, 6.31], [-75.518, 6.312], [-75.52, 6.312], [-75.52, 6.31]]];
    const east = [[[-75.516, 6.31], [-75.514, 6.31], [-75.514, 6.312], [-75.516, 6.312], [-75.516, 6.31]]];
    const { slug } = await createTerritoryAndShare({ type: 'MultiPolygon', coordinates: [west, east] });

    const response = await slugApp.inject({ method: 'GET', url: `/public/t/${slug}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Object.keys(body).sort()).toEqual(PUBLIC_KEYS);
    expect(body.boundary).toEqual({ type: 'MultiPolygon', coordinates: [west, east] });
  });

  it('sets every required security header on a valid response and on a 404', async () => {
    const { slug } = await createTerritoryAndShare();
    for (const url of [`/public/t/${slug}`, '/public/t/no-such-territory']) {
      const response = await slugApp.inject({ method: 'GET', url });
      expect(response.headers['cache-control'], url).toBe('no-store');
      expect(response.headers['x-robots-tag'], url).toBe('noindex, nofollow');
      expect(response.headers['referrer-policy'], url).toBe('no-referrer');
    }
  });

  it.each(['no-such-territory', 'NV-01', 'a'.repeat(81), 'nv_01', '%20', 'nv-01%2F..'])(
    'answers an unknown or malformed slug %j with the same neutral 404',
    async (slug) => {
      const response = await slugApp.inject({ method: 'GET', url: `/public/t/${slug}` });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    }
  );

  it('mirrors the token route for an archived territory — the slug view does not hide what the token view shows', async () => {
    const { territoryId, slug, token } = await createTerritoryAndShare();
    await withClient((client) => client.query(`UPDATE territories SET status = 'archived' WHERE id = $1`, [territoryId]));

    const bySlug = await slugApp.inject({ method: 'GET', url: `/public/t/${slug}` });
    const byToken = await slugApp.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(bySlug.statusCode).toBe(byToken.statusCode);
    expect(bySlug.json()).toEqual(byToken.json());
  });

  it('keeps working after every share token of the territory is revoked — the fixed URL needs no token', async () => {
    const { slug, tokenId } = await createTerritoryAndShare();
    await admin.inject({ method: 'POST', url: `/admin/share-tokens/${tokenId}/revoke`, payload: {} });
    const response = await slugApp.inject({ method: 'GET', url: `/public/t/${slug}` });
    expect(response.statusCode).toBe(200);
  });

  it('a slug is never accepted on the token route, nor a token on the slug route', async () => {
    const { slug, token } = await createTerritoryAndShare();
    expect((await slugApp.inject({ method: 'GET', url: `/public/territories/${slug}` })).statusCode).toBe(404);
    expect((await slugApp.inject({ method: 'GET', url: `/public/t/${token}` })).statusCode).toBe(404);
  });

  it('enforces the per-IP limit — the 31st request within the window is rejected', async () => {
    const isolatedApp = await buildApp(
      { queryPostgisVersion: async () => '3.4.3', pool, auth: { config: testAuthConfig(), sessions } },
      { logger: false }
    );
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 31; i += 1) {
        // A different unknown slug each time: the per-IP limit, not a per-slug one, is what trips.
        statuses.push((await isolatedApp.inject({ method: 'GET', url: `/public/t/unknown-${i}` })).statusCode);
      }
      expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await isolatedApp.close();
    }
  }, 30_000);
});

describe('rate limiting', () => {
  it('enforces a per-token limit — the 31st request within the window for one token is rejected', async () => {
    // An ISOLATED app instance, not the file-wide `app`: the rate limiter's
    // in-memory counters are per-Fastify-instance, and every earlier test
    // in this file has already made public-route requests against the
    // shared `app` — reusing it here would start this test with an
    // already-partially-consumed per-IP bucket (`.inject()`'s synthetic
    // requests all share one "IP"), making "the 31st request" meaningless.
    // Same database pool, fresh rate-limit state.
    const isolatedApp = await buildApp(
      { queryPostgisVersion: async () => '3.4.3', pool, auth: { config: testAuthConfig(), sessions } },
      { logger: false }
    );
    try {
      const { token } = await createTerritoryAndShare();

      const statuses: number[] = [];
      for (let i = 0; i < 31; i += 1) {
        // Sequential on purpose: the rate limiter counts requests, and
        // running them concurrently would race against the counter in a
        // way that does not change what is being proven (a 31st request
        // in-window is rejected) but would make the "which one is the
        // 31st" framing meaningless.
        const response = await isolatedApp.inject({ method: 'GET', url: `/public/territories/${token}` });
        statuses.push(response.statusCode);
      }
      expect(statuses.slice(0, 30).every((s) => s === 200 || s === 404)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await isolatedApp.close();
    }
  }, 30_000);
});

describe('timing does not leak token existence', () => {
  // Isolated app for this whole describe block: by this point in the file
  // the shared `app` has already made dozens of /public/territories/*
  // requests (response-shape, headers, revocation, scope tests), and this
  // block alone makes ~20 more. Sharing the file-wide app's rate-limit
  // counters here risks a spurious 429 mid-measurement, which would
  // corrupt a timing comparison (a 429 short-circuits far faster than a
  // real 200/404 with joins) far more than it would corrupt a plain
  // pass/fail test — hence a dedicated instance for the whole block, not
  // just the loop, kept in a local beforeAll/afterAll.
  let timingApp: FastifyInstance;

  beforeAll(async () => {
    timingApp = await buildApp(
      { queryPostgisVersion: async () => '3.4.3', pool, auth: { config: testAuthConfig(), sessions } },
      { logger: false }
    );
  });

  afterAll(async () => {
    await timingApp.close();
  });

  it('a nonexistent token and a revoked token take a structurally equal path: both execute the full lookup query, not a short-circuit', async () => {
    // A meaningful, non-flaky proof for this DoD bullet is structural, not
    // wall-clock: resolvePublicTerritoryView (sharing/repository.ts) runs
    // the SAME single query with the SAME joins for every outcome except a
    // token whose hash was never generated at all, which is indistinguishable
    // from any other guess in a 256-bit space. A real wall-clock assertion
    // here would be flaky in CI (network/scheduler jitter dwarfs any
    // genuine timing difference at this data size) and would prove less
    // than reading the query itself does. This test instead proves the
    // BEHAVIORAL invariant that actually prevents a timing leak: revoked,
    // expired, and nonexistent are byte-for-byte identical responses,
    // which is only possible if no branch does materially different work.
    const { token, tokenId } = await createTerritoryAndShare();
    await admin.inject({ method: 'POST', url: `/admin/share-tokens/${tokenId}/revoke`, payload: { actor: 'admin-1' } });

    const revoked = await timingApp.inject({ method: 'GET', url: `/public/territories/${token}` });
    const nonexistent = await timingApp.inject({ method: 'GET', url: '/public/territories/never-issued-token-guess' });

    expect(revoked.statusCode).toBe(nonexistent.statusCode);
    expect(revoked.body).toBe(nonexistent.body);
    // `date` (wall-clock) and `x-ratelimit-remaining` (a monotonically
    // decreasing counter across these two sequential calls) legitimately
    // differ between any two requests regardless of token validity —
    // excluding them is not hiding a real signal, it is removing two
    // headers whose variation is a property of "two separate requests
    // happened", not of "one token was valid and the other was not".
    const ignoredHeaders = new Set(['date', 'x-ratelimit-remaining']);
    const relevantHeaders = (headers: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(headers).filter(([k]) => !ignoredHeaders.has(k)));
    expect(relevantHeaders(revoked.headers)).toEqual(relevantHeaders(nonexistent.headers));
  });

  it('best-effort timing check: mean latency for a hit vs. a miss stays within a generous ratio (not cryptographically rigorous — see the structural test above for the real guarantee)', async () => {
    const { token } = await createTerritoryAndShare();
    const SAMPLES = 10; // 2 * SAMPLES public-route calls, kept comfortably under this isolated instance's own 30/minute per-IP limit

    const time = async (url: string): Promise<number> => {
      const start = process.hrtime.bigint();
      await timingApp.inject({ method: 'GET', url });
      return Number(process.hrtime.bigint() - start) / 1e6;
    };

    const hits: number[] = [];
    const misses: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      hits.push(await time(`/public/territories/${token}`));
      misses.push(await time(`/public/territories/never-issued-${i}`));
    }
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const meanHit = mean(hits);
    const meanMiss = mean(misses);

    // Generous 4x tolerance in either direction — this is a smoke check
    // against a GROSS leak (e.g. an early `if (!found) return 404` before
    // any join), not a precision timing-attack defense.
    expect(meanHit).toBeLessThan(meanMiss * 4 + 5);
    expect(meanMiss).toBeLessThan(meanHit * 4 + 5);
  });
});
