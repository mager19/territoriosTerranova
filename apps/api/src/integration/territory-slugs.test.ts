/**
 * Territory slugs (db/migrations/0011_territory_slugs.sql, domain/slug.ts)
 * against real PostGIS: the backfill of pre-existing rows, the SQL mirror
 * of the TypeScript normalization, uniqueness suffixing on creation (also
 * under concurrency), and slug stability.
 */

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DEFAULT_MIGRATIONS_DIR, listMigrationFiles, runMigrations } from '@territorios/geo/db/migrate';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../app.js';
import { createPgAdminSessionStore } from '../auth/session-store.js';
import { territorySlugBase } from '../domain/slug.js';
import { TEST_ADMIN_EMAIL, asAdmin, sessionCookieFor, testAuthConfig, type AuthenticatedClient } from '../test-support/admin-auth.js';

const IMAGE = 'postgis/postgis:16-3.4';
const SLUG_MIGRATION = '0011_territory_slugs.sql';

const FIXTURE_BOUNDARY_SQL = `
  INSERT INTO reference_municipal_boundary (id, name, geom, source_url, retrieved_at, attribution)
  VALUES (1, 'Bello (test fixture envelope)',
          ST_Multi(ST_SetSRID(ST_MakeEnvelope(-75.70, 6.20, -75.40, 6.55), 4326)),
          'integration-test-fixture', now(),
          'test fixture; see packages/geo/src/integration/db.test.ts for the real-boundary equivalent')
`;

/** A small square whose south-west corner moves with `index`, so squares never overlap. */
function square(index: number): unknown {
  const west = -75.6 + index * 0.003;
  const south = 6.3;
  return {
    type: 'Polygon',
    coordinates: [[[west, south], [west + 0.002, south], [west + 0.002, south + 0.002], [west, south + 0.002], [west, south]]]
  };
}

let container: StartedPostgreSqlContainer;
let databaseUrl: string;
let pool: Pool;
let app: FastifyInstance;
let admin: AuthenticatedClient;
let squareIndex = 0;

async function withClient<T>(url: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function createViaApi(name: string): Promise<{ id: number; slug: string }> {
  const response = await admin.inject({
    method: 'POST',
    url: '/admin/territories',
    payload: { name, geometry: square(squareIndex++), author: 'admin-1' }
  });
  expect(response.statusCode).toBe(201);
  const body = response.json() as { id: number; slug: string };
  return { id: body.id, slug: body.slug };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(IMAGE)
    .withDatabase('territorios_api_slugs_test')
    .withUsername('territorios')
    .withPassword('territorios')
    .withStartupTimeout(300_000)
    .start();
  databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);
  await withClient(databaseUrl, (client) => client.query(FIXTURE_BOUNDARY_SQL));

  pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const sessions = createPgAdminSessionStore(pool);
  app = await buildApp(
    { queryPostgisVersion: async () => '3.4.3', pool, auth: { config: testAuthConfig(), sessions } },
    { logger: false }
  );
  admin = asAdmin(app, await sessionCookieFor(sessions, TEST_ADMIN_EMAIL));
}, 360_000);

afterEach(async () => {
  await withClient(databaseUrl, (client) => client.query(`UPDATE territories SET status = 'archived' WHERE status = 'active'`));
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

describe('0011 backfill of territories that existed before slugs', () => {
  it('derives each slug from the name and dedupes collisions deterministically by id', async () => {
    const adminUrl = databaseUrl;
    await withClient(adminUrl, (client) => client.query('CREATE DATABASE territorios_backfill'));
    const backfillUrl = adminUrl.replace(/\/territorios_api_slugs_test(\?|$)/, '/territorios_backfill$1');

    const tmp = mkdtempSync(path.join(tmpdir(), 'territorios-slug-backfill-'));
    try {
      const before = listMigrationFiles().filter((filename) => filename < SLUG_MIGRATION);
      for (const filename of before) {
        copyFileSync(path.join(DEFAULT_MIGRATIONS_DIR, filename), path.join(tmp, filename));
      }
      await runMigrations(backfillUrl, { migrationsDir: tmp });

      await withClient(backfillUrl, (client) =>
        client.query(
          `INSERT INTO territories (name) VALUES
             ('Nv-01'), ('Barrio Niquía 3'), ('nv 01'), ('NV_01'), ('###'), ('Nv-01-2'), ('')`
        )
      );

      copyFileSync(path.join(DEFAULT_MIGRATIONS_DIR, SLUG_MIGRATION), path.join(tmp, SLUG_MIGRATION));
      const result = await runMigrations(backfillUrl, { migrationsDir: tmp });
      expect(result.applied).toEqual([SLUG_MIGRATION]);

      const rows = await withClient(backfillUrl, async (client) => {
        const { rows } = await client.query<{ name: string; slug: string }>(
          'SELECT name, slug FROM territories ORDER BY id'
        );
        return rows;
      });
      expect(rows).toEqual([
        { name: 'Nv-01', slug: 'nv-01' },
        { name: 'Barrio Niquía 3', slug: 'barrio-niquia-3' },
        { name: 'nv 01', slug: 'nv-01-2' },
        { name: 'NV_01', slug: 'nv-01-3' },
        { name: '###', slug: 'territorio' },
        // Its natural slug was already taken by the dedupe of 'nv 01' (lower id).
        { name: 'Nv-01-2', slug: 'nv-01-2-2' },
        { name: '', slug: 'territorio-2' }
      ]);

      const column = await withClient(backfillUrl, async (client) => {
        const { rows } = await client.query<{ is_nullable: string }>(
          `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'territories' AND column_name = 'slug'`
        );
        return rows[0];
      });
      expect(column?.is_nullable).toBe('NO');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('territory_slug_base (SQL) mirrors territorySlugBase (TypeScript)', () => {
  it('produces the same slug for every sample name', async () => {
    const names = [
      'Nv-01',
      'Barrio Niquía 3',
      'Pérez Ñuñoa Álvarez Güemes',
      'CAÑAVERAL – ÉXITO',
      'Calle 50 # 45-12 (Sur)',
      'Ünïcödé Ståd',
      'a__b..c',
      '--Zona--',
      'N°7',
      '',
      '¿?¡!',
      `${'a'.repeat(59)} bcd`,
      'Çàrrérà Ÿ ôù'
    ];
    const sqlSlugs = await withClient(databaseUrl, async (client) => {
      const { rows } = await client.query<{ slug: string }>(
        'SELECT territory_slug_base(name) AS slug FROM unnest($1::text[]) WITH ORDINALITY AS t(name, n) ORDER BY n',
        [names]
      );
      return rows.map((row) => row.slug);
    });
    expect(sqlSlugs).toEqual(names.map(territorySlugBase));
  });
});

describe('slug on territory creation', () => {
  it('returns the slug and exposes it on the admin list and detail', async () => {
    const created = await createViaApi('Zona Creación 1');
    expect(created.slug).toBe('zona-creacion-1');

    const detail = await admin.inject({ method: 'GET', url: `/admin/territories/${created.id}` });
    expect(detail.json().slug).toBe('zona-creacion-1');

    const list = await admin.inject({ method: 'GET', url: '/admin/territories' });
    const item = (list.json().territories as { id: number; slug: string }[]).find((t) => t.id === created.id);
    expect(item?.slug).toBe('zona-creacion-1');
  });

  it('suffixes -2, -3 … when another territory already has the slug', async () => {
    const first = await createViaApi('Suffix Test');
    const second = await createViaApi('suffix test');
    const third = await createViaApi('SUFFIX_TEST');
    expect([first.slug, second.slug, third.slug]).toEqual(['suffix-test', 'suffix-test-2', 'suffix-test-3']);
  });

  it('never hands out the same slug to concurrent creations of the same name', async () => {
    const created = await Promise.all(Array.from({ length: 5 }, () => createViaApi('Concurrente')));
    const slugs = created.map((territory) => territory.slug).sort();
    expect(slugs).toEqual(['concurrente', 'concurrente-2', 'concurrente-3', 'concurrente-4', 'concurrente-5']);
  });

  it('assigns a slug to a row inserted without one (database fallback)', async () => {
    const slug = await withClient(databaseUrl, async (client) => {
      const { rows } = await client.query<{ slug: string }>(
        `INSERT INTO territories (name) VALUES ('Fallback Ñandú') RETURNING slug`
      );
      return rows[0]?.slug;
    });
    expect(slug).toBe('fallback-nandu');
  });

  it('rejects a duplicate slug at the database (unique index backstop)', async () => {
    await createViaApi('Unique Backstop');
    await expect(
      withClient(databaseUrl, (client) =>
        client.query(`INSERT INTO territories (name, slug) VALUES ('other', 'unique-backstop')`)
      )
    ).rejects.toThrow(/territories_slug_unique/);
  });

  it('keeps the slug stable when the territory changes (number set, new revision)', async () => {
    const created = await createViaApi('Estable');
    await admin.inject({ method: 'PATCH', url: `/admin/territories/${created.id}/number`, payload: { number: 'E-1' } });
    await admin.inject({
      method: 'POST',
      url: `/admin/territories/${created.id}/revisions`,
      payload: { geometry: square(squareIndex++), author: 'admin-1' }
    });
    const detail = await admin.inject({ method: 'GET', url: `/admin/territories/${created.id}` });
    expect(detail.json().slug).toBe('estable');
  });

  it('refuses to change a slug once assigned — shared links depend on it', async () => {
    const created = await createViaApi('Inmutable');
    await expect(
      withClient(databaseUrl, (client) => client.query(`UPDATE territories SET slug = 'otro' WHERE id = $1`, [created.id]))
    ).rejects.toThrow(/slug is immutable/);
    // Renaming leaves the slug alone.
    await withClient(databaseUrl, (client) => client.query(`UPDATE territories SET name = 'Renombrado' WHERE id = $1`, [created.id]));
    const detail = await admin.inject({ method: 'GET', url: `/admin/territories/${created.id}` });
    expect(detail.json()).toMatchObject({ name: 'Renombrado', slug: 'inmutable' });
  });
});
