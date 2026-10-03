/**
 * Admin authentication against real PostGIS (Testcontainers): the
 * PostgreSQL session store (hashed tokens, expiry, revocation), sign-in and
 * sign-out over HTTP, and — the point of the whole boundary — that every
 * admin write records the SESSION email as its actor, ignoring any actor
 * field the client sends.
 */

import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '@territorios/geo/db/migrate';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../app.js';
import { createPgAdminSessionStore, type AdminSessionStore } from '../auth/session-store.js';
import {
  SECOND_ADMIN_EMAIL,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  asAdmin,
  sessionCookieFor,
  testAuthConfig,
  type AuthenticatedClient
} from '../test-support/admin-auth.js';

const IMAGE = 'postgis/postgis:16-3.4';
const SPOOFED = 'mallory@evil.example';

function rectangle(west: number, south: number, east: number, north: number) {
  return {
    type: 'Polygon',
    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]]
  };
}
const SQUARE = rectangle(-75.574, 6.357, -75.572, 6.359);
const WEST_HALF = rectangle(-75.574, 6.357, -75.573, 6.359);

const FIXTURE_BOUNDARY_SQL = `
  INSERT INTO reference_municipal_boundary (id, name, geom, source_url, retrieved_at, attribution)
  VALUES (1, 'Bello (test fixture envelope)',
          ST_Multi(ST_SetSRID(ST_MakeEnvelope(-75.70, 6.20, -75.40, 6.55), 4326)),
          'integration-test-fixture', now(), 'test fixture')
`;

let container: StartedPostgreSqlContainer;
let databaseUrl: string;
let pool: Pool;
let app: FastifyInstance;
let sessions: AdminSessionStore;

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(IMAGE)
    .withDatabase('territorios_api_admin_auth_test')
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
}, 360_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

describe('PostgreSQL admin session store', () => {
  it('stores only the SHA-256 hash of the token, with a 7-day expiry', async () => {
    const { token, session } = await sessions.create('Admin@Example.TEST');

    const rows = await withClient(async (client) => {
      const result = await client.query<{ token_hash: string; email: string; ttl_seconds: string }>(
        `SELECT token_hash, email, extract(epoch FROM expires_at - created_at)::bigint AS ttl_seconds
         FROM admin_sessions WHERE id = $1`,
        [session.id]
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toBe(sha256Hex(token));
    expect(rows[0]?.token_hash).not.toContain(token);
    expect(rows[0]?.email).toBe(TEST_ADMIN_EMAIL);
    expect(Number(rows[0]?.ttl_seconds)).toBe(7 * 24 * 60 * 60);

    expect(await sessions.resolve(token)).toMatchObject({ id: session.id, email: TEST_ADMIN_EMAIL });
  });

  it('rejects an expired session', async () => {
    const { token, session } = await sessions.create(TEST_ADMIN_EMAIL);
    await withClient((client) =>
      client.query(
        `UPDATE admin_sessions SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1`,
        [session.id]
      )
    );
    expect(await sessions.resolve(token)).toBeNull();
    const response = await app.inject({ method: 'GET', url: '/admin/me', headers: { cookie: `admin_session=${token}` } });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a revoked session', async () => {
    const { token } = await sessions.create(TEST_ADMIN_EMAIL);
    await sessions.revoke(token);
    expect(await sessions.resolve(token)).toBeNull();
    const response = await app.inject({ method: 'GET', url: '/admin/me', headers: { cookie: `admin_session=${token}` } });
    expect(response.statusCode).toBe(401);
  });

  it('rejects the stored hash used as if it were the token', async () => {
    const { token } = await sessions.create(TEST_ADMIN_EMAIL);
    expect(await sessions.resolve(sha256Hex(token))).toBeNull();
  });
});

describe('sign-in and sign-out over HTTP', () => {
  it('sign-in creates a hashed session row for the account email; logout revokes it', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }
    });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0] as string;
    const token = cookie.split('=')[1] as string;

    const row = await withClient(async (client) => {
      const result = await client.query<{ email: string; revoked_at: Date | null }>(
        'SELECT email, revoked_at FROM admin_sessions WHERE token_hash = $1',
        [sha256Hex(token)]
      );
      return result.rows[0];
    });
    expect(row).toEqual({ email: TEST_ADMIN_EMAIL, revoked_at: null });

    const me = await app.inject({ method: 'GET', url: '/admin/me', headers: { cookie } });
    expect(me.json()).toEqual({ email: TEST_ADMIN_EMAIL });

    const logout = await app.inject({ method: 'POST', url: '/admin/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(204);
    const revokedAt = await withClient(async (client) => {
      const result = await client.query<{ revoked_at: Date | null }>(
        'SELECT revoked_at FROM admin_sessions WHERE token_hash = $1',
        [sha256Hex(token)]
      );
      return result.rows[0]?.revoked_at;
    });
    expect(revokedAt).toBeInstanceOf(Date);

    const after = await app.inject({ method: 'GET', url: '/admin/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('a failed sign-in creates no session row', async () => {
    const before = await withClient(async (client) => (await client.query('SELECT count(*)::int AS n FROM admin_sessions')).rows[0]);
    const response = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { email: TEST_ADMIN_EMAIL, password: 'definitely-not-it' }
    });
    expect(response.statusCode).toBe(401);
    const after = await withClient(async (client) => (await client.query('SELECT count(*)::int AS n FROM admin_sessions')).rows[0]);
    expect(after).toEqual(before);
  });
});

describe('actor = session email on every admin write', () => {
  let first: AuthenticatedClient;
  let second: AuthenticatedClient;

  beforeAll(async () => {
    first = asAdmin(app, await sessionCookieFor(sessions, TEST_ADMIN_EMAIL));
    second = asAdmin(app, await sessionCookieFor(sessions, SECOND_ADMIN_EMAIL));
  });

  async function auditActors(territoryId: number): Promise<Array<{ action: string; actor: string }>> {
    return withClient(async (client) => {
      const result = await client.query<{ action: string; actor: string }>(
        `SELECT action, actor FROM audit_events WHERE entity_type = 'territory' AND entity_id = $1 ORDER BY id`,
        [territoryId]
      );
      return result.rows;
    });
  }

  it('records the signed-in administrator, never the client-sent author/actor/recordedBy/createdBy', async () => {
    const created = await first.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: 'T-actor', geometry: SQUARE, author: SPOOFED }
    });
    expect(created.statusCode).toBe(201);
    const territoryId = created.json().id as number;
    expect(created.json().revisions[0].author).toBe(TEST_ADMIN_EMAIL);

    const revised = await second.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/revisions`,
      payload: { geometry: SQUARE, author: SPOOFED }
    });
    expect(revised.statusCode).toBe(201);
    expect(revised.json().author).toBe(SECOND_ADMIN_EMAIL);

    const opened = await first.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/operational-state`,
      payload: { action: 'in_progress', actor: SPOOFED }
    });
    expect(opened.statusCode).toBe(201);

    const progress = await second.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/progress`,
      payload: { recordedBy: SPOOFED, coveredArea: WEST_HALF, baseline: 'whole_territory' }
    });
    expect(progress.statusCode).toBe(201);
    expect(progress.json().recordedBy).toBe(SECOND_ADMIN_EMAIL);

    const shared = await first.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/share-tokens`,
      payload: { createdBy: SPOOFED }
    });
    expect(shared.statusCode).toBe(201);
    const revoked = await second.inject({
      method: 'POST',
      url: `/admin/share-tokens/${shared.json().id}/revoke`,
      payload: { actor: SPOOFED }
    });
    expect(revoked.statusCode).toBe(204);

    expect(await auditActors(territoryId)).toEqual([
      { action: 'created', actor: TEST_ADMIN_EMAIL },
      { action: 'revision_submitted', actor: SECOND_ADMIN_EMAIL },
      { action: 'operational_in_progress', actor: TEST_ADMIN_EMAIL },
      { action: 'progress_recorded', actor: SECOND_ADMIN_EMAIL },
      { action: 'shared', actor: TEST_ADMIN_EMAIL },
      { action: 'share_revoked', actor: SECOND_ADMIN_EMAIL }
    ]);

    const stored = await withClient(async (client) => {
      const operational = await client.query<{ actor: string }>(
        'SELECT actor FROM territory_operational_events WHERE territory_id = $1',
        [territoryId]
      );
      const entries = await client.query<{ recorded_by: string }>(
        'SELECT recorded_by FROM progress_entries WHERE territory_id = $1',
        [territoryId]
      );
      return { operational: operational.rows, entries: entries.rows };
    });
    expect(stored).toEqual({
      operational: [{ actor: TEST_ADMIN_EMAIL }],
      entries: [{ recorded_by: SECOND_ADMIN_EMAIL }]
    });
    const everything = JSON.stringify(await auditActors(territoryId));
    expect(everything).not.toContain(SPOOFED);
  });
});
