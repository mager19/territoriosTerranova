/**
 * Database integration tests — real PostGIS via Testcontainers.
 *
 * Every rejection asserted here is enforced BY THE DATABASE (CHECK
 * constraints, typmod casts, triggers, unique indexes), never by
 * application code. Expected SQLSTATEs and constraint names were pinned
 * from observed behavior on postgis/postgis:16-3.4.
 *
 * One container, one migrated database, ordered describes: state accumulates
 * (append-only tables cannot be cleaned), so each describe creates its own
 * territories with unique names.
 */

import { appendFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { DEFAULT_MIGRATIONS_DIR, listMigrationFiles, runMigrations } from '../db/migrate.js';
import { runSeed } from '../db/seed.js';

const IMAGE = 'postgis/postgis:16-3.4';

// Geometry fixtures around the verified Bello sample vertex
// [-75.57307274994052, 6.358147322663799] (docs/map-references.md).
const VALID_SQUARE =
  'POLYGON((-75.574 6.357, -75.572 6.357, -75.572 6.359, -75.574 6.359, -75.574 6.357))';
const BOWTIE =
  'POLYGON((-75.574 6.357, -75.572 6.359, -75.572 6.357, -75.574 6.359, -75.574 6.357))';
const COLLINEAR = 'POLYGON((-75.574 6.357, -75.573 6.358, -75.572 6.359, -75.574 6.357))';
const COLLINEAR_LONG = 'POLYGON((-75.6 6.3, -75.55 6.35, -75.5 6.4, -75.6 6.3))';
// Overlapping pair: interiors intersect in a real area (not mere touching).
const OVERLAP_A = 'POLYGON((-75.580 6.350, -75.574 6.350, -75.574 6.356, -75.580 6.356, -75.580 6.350))';
const OVERLAP_B = 'POLYGON((-75.577 6.353, -75.571 6.353, -75.571 6.359, -75.577 6.359, -75.577 6.353))';
// Adjacent pair sharing exactly one edge: ST_Touches, no interior intersection.
const TOUCHING_WEST = 'POLYGON((-75.590 6.340, -75.585 6.340, -75.585 6.345, -75.590 6.345, -75.590 6.340))';
const TOUCHING_EAST = 'POLYGON((-75.585 6.340, -75.580 6.340, -75.580 6.345, -75.585 6.345, -75.585 6.340))';
// Far outside both the test fixture envelope and the real Bello boundary.
const OUTSIDE_BELLO = 'POLYGON((-76.10 6.90, -76.09 6.90, -76.09 6.91, -76.10 6.91, -76.10 6.90))';

// Test fixture boundary: a generous envelope around Bello. The AMVA seed
// describe replaces it with the real municipal boundary at the end.
const FIXTURE_BOUNDARY_SQL = `
  INSERT INTO reference_municipal_boundary (id, name, geom, source_url, retrieved_at, attribution)
  VALUES (1, 'Bello (test fixture envelope)',
          ST_Multi(ST_SetSRID(ST_MakeEnvelope(-75.70, 6.20, -75.40, 6.55), 4326)),
          'integration-test-fixture', now(),
          'test fixture; replaced by the AMVA seed describe')
`;

let container: StartedPostgreSqlContainer;
let databaseUrl: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer(IMAGE)
    .withDatabase('territorios_test')
    .withUsername('territorios')
    .withPassword('territorios')
    .withStartupTimeout(300_000)
    .start();
  databaseUrl = container.getConnectionUri();
  // DoD: migrations run from an EMPTY database to current.
  await runMigrations(databaseUrl);
  // Containment fails closed without a boundary reference: load the fixture
  // envelope before any test inserts geometry.
  await withClient((client) => client.query(FIXTURE_BOUNDARY_SQL));
}, 360_000);

beforeEach(async () => {
  // Overlap enforcement considers ACTIVE territories only. Archive everything
  // between tests so each one starts from a clean overlap slate (append-only
  // tables cannot be truncated).
  await withClient((client) =>
    client.query(`UPDATE territories SET status = 'archived' WHERE status = 'active'`)
  );
});

afterAll(async () => {
  await container?.stop();
});

interface PgError {
  readonly code?: string;
  readonly constraint?: string;
  readonly message: string;
}

function asPgError(reason: unknown): PgError {
  return reason as PgError;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function createTerritory(client: Client, name: string): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    'INSERT INTO territories (name) VALUES ($1) RETURNING id',
    [name]
  );
  return Number(rows[0]?.id);
}

async function insertRevision(
  client: Client,
  territoryId: number,
  revisionNumber: number,
  wkt: string,
  author = 'integration-test'
): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO territory_revisions (territory_id, revision_number, geom, author)
     VALUES ($1, $2, ST_SetSRID(ST_GeomFromText($3), 4326), $4)
     RETURNING id`,
    [territoryId, revisionNumber, wkt, author]
  );
  return Number(rows[0]?.id);
}

describe('migration runner', () => {
  it('applied every migration file from an empty database and recorded checksums', async () => {
    await withClient(async (client) => {
      const migrations = await client.query<{ filename: string; checksum: string }>(
        'SELECT filename, checksum FROM schema_migrations ORDER BY filename'
      );
      expect(migrations.rows.map((row) => row.filename)).toEqual(listMigrationFiles());
      for (const row of migrations.rows) {
        expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
      }

      const postgis = await client.query<{ v: string }>('SELECT postgis_version() AS v');
      expect(typeof postgis.rows[0]?.v).toBe('string');

      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
      );
      const tableNames = tables.rows.map((row) => row.table_name);
      expect(tableNames).toEqual(
        expect.arrayContaining([
          'admin_sessions',
          'audit_events',
          'progress_entries',
          'reference_barrios',
          'reference_municipal_boundary',
          'schema_migrations',
          'share_tokens',
          'territories',
          'territory_revisions'
        ])
      );
      // Absence is asserted, not merely un-asserted: 0004 DROPs `assignments`
      // (territories are shared to a group, never assigned to one person), so
      // a schema built from empty must not have it. Without this, a migration
      // that silently failed to apply — or a reintroduced table — would leave
      // every other assertion here still green.
      expect(tableNames).not.toContain('assignments');
    });
  });

  it('is idempotent: a second run applies nothing', async () => {
    const result = await runMigrations(databaseUrl);
    expect(result.applied).toEqual([]);
    expect(result.upToDate).toEqual(listMigrationFiles());
  });

  it('refuses to run a modified migration (forward-only)', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'territorios-migrations-'));
    try {
      for (const filename of listMigrationFiles()) {
        copyFileSync(path.join(DEFAULT_MIGRATIONS_DIR, filename), path.join(tmp, filename));
      }

      const unchanged = await runMigrations(databaseUrl, { migrationsDir: tmp });
      expect(unchanged.applied).toEqual([]);

      appendFileSync(path.join(tmp, '0001_postgis.sql'), '\n-- tampered after apply\n');

      await expect(runMigrations(databaseUrl, { migrationsDir: tmp })).rejects.toThrow(
        /forward-only violation/
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('geometry constraints are enforced by the database', () => {
  it('accepts a valid WGS84 polygon and stores it as SRID 4326', async () => {
    await withClient(async (client) => {
      const territoryId = await createTerritory(client, 'geom-valid');
      const revisionId = await insertRevision(client, territoryId, 1, VALID_SQUARE);

      const stored = await client.query<{ srid: number; valid: boolean }>(
        'SELECT ST_SRID(geom) AS srid, ST_IsValid(geom) AS valid FROM territory_revisions WHERE id = $1',
        [revisionId]
      );
      expect(stored.rows[0]).toEqual({ srid: 4326, valid: true });
    });
  });

  it('rejects a non-simple (bowtie) polygon with a CHECK violation', async () => {
    await withClient(async (client) => {
      const territoryId = await createTerritory(client, 'geom-bowtie');
      try {
        await insertRevision(client, territoryId, 1, BOWTIE);
        expect.unreachable('bowtie polygon was accepted');
      } catch (error) {
        const pgError = asPgError(error);
        expect(pgError.code).toBe('23514');
        expect(pgError.constraint).toMatch(/geom_has_area|geom_valid/);
      }
    });
  });

  it('rejects zero-area degenerate polygons (collinear rings, short and long span)', async () => {
    await withClient(async (client) => {
      const territoryId = await createTerritory(client, 'geom-collinear');
      for (const wkt of [COLLINEAR, COLLINEAR_LONG]) {
        try {
          await insertRevision(client, territoryId, 1, wkt);
          expect.unreachable(`zero-area polygon was accepted: ${wkt}`);
        } catch (error) {
          const pgError = asPgError(error);
          expect(pgError.code).toBe('23514');
          expect(pgError.constraint).toBe('territory_revisions_geom_has_area');
        }
      }
    });
  });

  it('rejects a geometry in the wrong SRID', async () => {
    await withClient(async (client) => {
      const territoryId = await createTerritory(client, 'geom-srid');
      try {
        await client.query(
          `INSERT INTO territory_revisions (territory_id, revision_number, geom, author)
           VALUES ($1, 1, ST_GeomFromText($2, 3857), 'integration-test')`,
          [territoryId, VALID_SQUARE]
        );
        expect.unreachable('SRID 3857 geometry was accepted');
      } catch (error) {
        const pgError = asPgError(error);
        expect(pgError.code).toBe('22023');
        expect(pgError.message).toMatch(/does not match column SRID/);
      }
    });
  });

  it('coerces SRID 0 (unspecified) to 4326 on assignment, keeping the column invariant', async () => {
    await withClient(async (client) => {
      const territoryId = await createTerritory(client, 'geom-srid-zero');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO territory_revisions (territory_id, revision_number, geom, author)
         VALUES ($1, 1, ST_GeomFromText($2, 0), 'integration-test')
         RETURNING id`,
        [territoryId, VALID_SQUARE]
      );
      const stored = await client.query<{ srid: number }>(
        'SELECT ST_SRID(geom) AS srid FROM territory_revisions WHERE id = $1',
        [Number(rows[0]?.id)]
      );
      expect(stored.rows[0]?.srid).toBe(4326);
    });
  });

  it('rejects a non-polygon geometry type', async () => {
    await withClient(async (client) => {
      const territoryId = await createTerritory(client, 'geom-type');
      try {
        await client.query(
          `INSERT INTO territory_revisions (territory_id, revision_number, geom, author)
           VALUES ($1, 1, ST_SetSRID(ST_GeomFromText('LINESTRING(-75.574 6.357, -75.572 6.359)'), 4326), 'integration-test')`,
          [territoryId]
        );
        expect.unreachable('LineString was accepted into a Polygon column');
      } catch (error) {
        const pgError = asPgError(error);
        expect(pgError.code).toBe('22023');
        expect(pgError.message).toMatch(/Geometry type \(LineString\) does not match column type/);
      }
    });
  });
});

describe('territory number', () => {
  it('rejects two territories sharing a number', async () => {
    await withClient(async (client) => {
      await client.query(`INSERT INTO territories (name, number) VALUES ('number-a', 'T-1')`);
      try {
        await client.query(`INSERT INTO territories (name, number) VALUES ('number-b', 'T-1')`);
        expect.unreachable('duplicate territory number was accepted');
      } catch (error) {
        const pgError = asPgError(error);
        expect(pgError.code).toBe('23505');
        expect(pgError.constraint).toBe('territories_number_unique');
      }
    });
  });

  it('allows many territories with no number at all', async () => {
    await withClient(async (client) => {
      await client.query(`INSERT INTO territories (name) VALUES ('unnumbered-a'), ('unnumbered-b')`);
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM territories WHERE number IS NULL AND name LIKE 'unnumbered-%'`
      );
      expect(rows[0]?.n).toBe(2);
    });
  });
});

describe('territory_revisions is immutable', () => {
  it('rejects UPDATE of any column, including geom', async () => {
    await withClient(async (client) => {
      const territoryId = await createTerritory(client, 'immutable-update');
      const revisionId = await insertRevision(client, territoryId, 1, VALID_SQUARE);

      for (const statement of [
        `UPDATE territory_revisions SET author = 'tampered' WHERE id = $1`,
        `UPDATE territory_revisions SET geom = ST_SetSRID(ST_GeomFromText('${COLLINEAR}'), 4326) WHERE id = $1`
      ]) {
        try {
          await client.query(statement, [revisionId]);
          expect.unreachable('UPDATE of territory_revisions was accepted');
        } catch (error) {
          const pgError = asPgError(error);
          expect(pgError.code).toBe('P0001');
          expect(pgError.message).toMatch(/territory_revisions is append-only: UPDATE is not allowed/);
        }
      }
    });
  });

  it('rejects DELETE', async () => {
    await withClient(async (client) => {
      const territoryId = await createTerritory(client, 'immutable-delete');
      const revisionId = await insertRevision(client, territoryId, 1, VALID_SQUARE);
      try {
        await client.query('DELETE FROM territory_revisions WHERE id = $1', [revisionId]);
        expect.unreachable('DELETE of territory_revisions was accepted');
      } catch (error) {
        const pgError = asPgError(error);
        expect(pgError.code).toBe('P0001');
        expect(pgError.message).toMatch(/append-only: DELETE is not allowed/);
      }
    });
  });

  it('rejects TRUNCATE', async () => {
    await withClient(async (client) => {
      try {
        await client.query('TRUNCATE territory_revisions');
        expect.unreachable('TRUNCATE of territory_revisions was accepted');
      } catch (error) {
        // Either the FK guard (0A000) or the append-only trigger (P0001)
        // refuses first; both are database-level rejection.
        const pgError = asPgError(error);
        expect(['0A000', 'P0001']).toContain(pgError.code);
        expect(pgError.message).toMatch(/cannot truncate|append-only/);
      }
    });
  });

  it('still allows appending a new revision (immutable != frozen)', async () => {
    await withClient(async (client) => {
      const territoryId = await createTerritory(client, 'immutable-append');
      await insertRevision(client, territoryId, 1, VALID_SQUARE);
      const second = await insertRevision(client, territoryId, 2, VALID_SQUARE);
      expect(second).toBeGreaterThan(0);

      const current = await client.query<{ revision_number: number }>(
        `SELECT revision_number FROM territory_revisions
         WHERE territory_id = $1 ORDER BY revision_number DESC LIMIT 1`,
        [territoryId]
      );
      expect(current.rows[0]?.revision_number).toBe(2);
    });
  });
});

describe('containment in the municipal boundary (database-enforced)', () => {
  it('rejects a revision outside the Bello boundary', async () => {
    await withClient(async (client) => {
      const territoryId = await createTerritory(client, 'containment-outside');
      try {
        await insertRevision(client, territoryId, 1, OUTSIDE_BELLO);
        expect.unreachable('out-of-boundary revision was accepted');
      } catch (error) {
        const pgError = asPgError(error);
        expect(pgError.code).toBe('P0001');
        expect(pgError.message).toMatch(/is not contained by the Bello municipal boundary/);
      }
    });
  });

  it('accepts a revision inside the boundary', async () => {
    await withClient(async (client) => {
      const territoryId = await createTerritory(client, 'containment-inside');
      const revisionId = await insertRevision(client, territoryId, 1, VALID_SQUARE);
      expect(revisionId).toBeGreaterThan(0);
    });
  });

  it('fails closed when the boundary reference is not loaded', async () => {
    await withClient(async (client) => {
      try {
        await client.query('DELETE FROM reference_municipal_boundary');
        const territoryId = await createTerritory(client, 'containment-fail-closed');
        try {
          await insertRevision(client, territoryId, 1, VALID_SQUARE);
          expect.unreachable('revision was accepted without a boundary reference');
        } catch (error) {
          const pgError = asPgError(error);
          expect(pgError.code).toBe('P0001');
          expect(pgError.message).toMatch(/municipal boundary reference not loaded/);
        }
      } finally {
        await client.query(FIXTURE_BOUNDARY_SQL);
      }
    });
  });
});

describe('overlap between active territories (database-enforced)', () => {
  it('rejects a revision overlapping another active territory', async () => {
    await withClient(async (client) => {
      const territoryA = await createTerritory(client, 'overlap-a');
      await insertRevision(client, territoryA, 1, OVERLAP_A);

      const territoryB = await createTerritory(client, 'overlap-b');
      try {
        await insertRevision(client, territoryB, 1, OVERLAP_B);
        expect.unreachable('overlapping revision was accepted');
      } catch (error) {
        const pgError = asPgError(error);
        expect(pgError.code).toBe('P0001');
        expect(pgError.message).toMatch(/overlaps active territory/);
      }
    });
  });

  it('allows adjacent territories that only touch', async () => {
    await withClient(async (client) => {
      const west = await createTerritory(client, 'touching-west');
      await insertRevision(client, west, 1, TOUCHING_WEST);
      const east = await createTerritory(client, 'touching-east');
      const eastRevision = await insertRevision(client, east, 1, TOUCHING_EAST);
      expect(eastRevision).toBeGreaterThan(0);
    });
  });

  it('allows an overlap only through an explicit authorized exception', async () => {
    await withClient(async (client) => {
      const territoryA = await createTerritory(client, 'exception-a');
      await insertRevision(client, territoryA, 1, OVERLAP_A);
      const territoryB = await createTerritory(client, 'exception-b');

      // Without an exception: rejected.
      await expect(insertRevision(client, territoryB, 1, OVERLAP_B)).rejects.toThrow(
        /overlaps active territory/
      );

      // The exception pair must be canonically ordered (a < b).
      try {
        await client.query(
          `INSERT INTO territory_overlap_exceptions (territory_a_id, territory_b_id, authorized_by, reason)
           VALUES (GREATEST($1::bigint, $2::bigint), LEAST($1::bigint, $2::bigint), 'admin', 'wrong order on purpose')`,
          [territoryA, territoryB]
        );
        expect.unreachable('unordered exception pair was accepted');
      } catch (error) {
        expect(asPgError(error).code).toBe('23514');
        expect(asPgError(error).constraint).toBe('overlap_exception_pair_ordered');
      }

      // With an authorized exception: the same geometry is accepted.
      await client.query(
        `INSERT INTO territory_overlap_exceptions (territory_a_id, territory_b_id, authorized_by, reason)
         VALUES (LEAST($1::bigint, $2::bigint), GREATEST($1::bigint, $2::bigint), 'coordinador-operaciones', 'shared access corridor approved for pilotage')`,
        [territoryA, territoryB]
      );
      const revisionB = await insertRevision(client, territoryB, 1, OVERLAP_B);
      expect(revisionB).toBeGreaterThan(0);
    });
  });

  it('ignores archived territories, and reactivation re-runs the overlap check', async () => {
    await withClient(async (client) => {
      const archived = await createTerritory(client, 'reactivation-archived');
      await insertRevision(client, archived, 1, VALID_SQUARE);
      await client.query(`UPDATE territories SET status = 'archived' WHERE id = $1`, [archived]);

      // Same geometry, no conflict while the first territory is archived.
      const active = await createTerritory(client, 'reactivation-active');
      await insertRevision(client, active, 1, VALID_SQUARE);

      // Reactivating the archived territory would overlap the active one.
      try {
        await client.query(`UPDATE territories SET status = 'active' WHERE id = $1`, [archived]);
        expect.unreachable('reactivation with an overlap was accepted');
      } catch (error) {
        const pgError = asPgError(error);
        expect(pgError.code).toBe('P0001');
        expect(pgError.message).toMatch(/overlaps active territory/);
      }

      const stillArchived = await client.query<{ status: string }>(
        'SELECT status FROM territories WHERE id = $1',
        [archived]
      );
      expect(stillArchived.rows[0]?.status).toBe('archived');
    });
  });

  it('concurrent overlapping revisions leave exactly one survivor', async () => {
    const first = new Client({ connectionString: databaseUrl });
    const second = new Client({ connectionString: databaseUrl });
    await first.connect();
    await second.connect();

    const createWithRevision = async (client: Client, name: string, holdMs: number) => {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        'INSERT INTO territories (name) VALUES ($1) RETURNING id',
        [name]
      );
      await client.query(
        `INSERT INTO territory_revisions (territory_id, revision_number, geom, author)
         VALUES ($1, 1, ST_SetSRID(ST_GeomFromText($2), 4326), 'integration-test')`,
        [Number(rows[0]?.id), OVERLAP_A]
      );
      // Hold the transaction open: the advisory lock taken by the overlap
      // trigger is held until COMMIT, forcing the loser to re-check against
      // committed state.
      if (holdMs > 0) {
        await sleep(holdMs);
      }
      await client.query('COMMIT');
    };

    const results = await Promise.allSettled([
      createWithRevision(first, 'overlap-race-1', 750),
      createWithRevision(second, 'overlap-race-2', 0)
    ]);

    for (const client of [first, second]) {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const loserError = asPgError(rejected[0]?.reason);
    expect(loserError.code).toBe('P0001');
    expect(loserError.message).toMatch(/overlaps active territory/);

    const survivors = await withClient(async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM territories
         WHERE name IN ('overlap-race-1', 'overlap-race-2') AND status = 'active'`
      );
      return rows[0]?.n ?? -1;
    });

    // Verbatim evidence line for the handoff.
    console.log(
      `[overlap-concurrency] winner=1 loserSqlState=${loserError.code} activeSurvivors=${survivors}`
    );

    expect(survivors).toBe(1);
  });
});

describe('AMVA reference seed (offline, from the committed cache)', () => {
  const referenceCounts = async (client: Client) => {
    const barrios = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM reference_barrios'
    );
    const boundary = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM reference_municipal_boundary'
    );
    return { barrios: barrios.rows[0]?.n ?? -1, boundary: boundary.rows[0]?.n ?? -1 };
  };

  it('loads 139 barrios plus the municipal boundary with source metadata', async () => {
    const result = await runSeed(databaseUrl);
    expect(result).toEqual({ barrios: 139, boundary: 1 });

    await withClient(async (client) => {
      expect(await referenceCounts(client)).toEqual({ barrios: 139, boundary: 1 });

      const metadata = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM reference_municipal_boundary
         WHERE attribution LIKE '%Área Metropolitana del Valle de Aburrá%'
           AND source_url LIKE 'https://sim.metropol.gov.co/%'
           AND retrieved_at IS NOT NULL`
      );
      expect(metadata.rows[0]?.n).toBe(1);

      const barriosMetadata = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM reference_barrios
         WHERE attribution LIKE '%Área Metropolitana del Valle de Aburrá%'
           AND source_url LIKE 'https://sim.metropol.gov.co/%'
           AND retrieved_at IS NOT NULL`
      );
      expect(barriosMetadata.rows[0]?.n).toBe(139);

      // Every seeded geometry is a valid 4326 MultiPolygon (ST_Multi normalized).
      const badGeometry = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM reference_barrios
         WHERE NOT ST_IsValid(geom) OR ST_SRID(geom) <> 4326 OR GeometryType(geom) <> 'MULTIPOLYGON'`
      );
      expect(badGeometry.rows[0]?.n).toBe(0);
    });
  });

  it('is idempotent: a second run yields the same row counts', async () => {
    const before = await withClient(referenceCounts);
    const result = await runSeed(databaseUrl);
    const after = await withClient(referenceCounts);

    expect(result).toEqual({ barrios: 139, boundary: 1 });
    expect(before).toEqual({ barrios: 139, boundary: 1 });
    expect(after).toEqual(before);
  });

  it('loads the one AMVA barrio with no source attributes under a visible placeholder, not silently', async () => {
    await runSeed(databaseUrl);

    await withClient(async (client) => {
      // Exactly one of 139 real AMVA records (verified against the live cache)
      // carries no attributes at all. It must still be present — dropping a
      // real, valid polygon loses reference data — but under a name that can
      // never be mistaken for a genuine AMVA barrio name.
      const placeholder = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM reference_barrios
         WHERE nombre = 'Sector sin nombre (AMVA no registra atributos para este polígono)'`
      );
      expect(placeholder.rows[0]?.n).toBe(1);

      // No other barrio was swept into the placeholder — this is a single,
      // diagnosed anomaly, not a generic fallback for messy data.
      const total = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM reference_barrios');
      expect(total.rows[0]?.n).toBe(139);
    });
  });

  it('drops only the zero-area artifact from "Urb. Búcaros III", keeping its real boundary intact', async () => {
    await runSeed(databaseUrl);

    await withClient(async (client) => {
      const { rows } = await client.query<{ n: number; area: number; valid: boolean }>(
        `SELECT ST_NumGeometries(geom)::int AS n, ST_Area(geom) AS area, ST_IsValid(geom) AS valid
         FROM reference_barrios WHERE nombre = 'Urb. Búcaros III'`
      );
      expect(rows).toHaveLength(1);
      // The source MultiPolygon has 2 parts; only the real one (positive
      // area) survives sanitization — the zero-area artifact is gone.
      expect(rows[0]?.n).toBe(1);
      expect(rows[0]?.valid).toBe(true);
      expect(rows[0]?.area).toBeGreaterThan(0);
    });
  });

  it('containment now enforces the REAL seeded Bello boundary', async () => {
    await withClient(async (client) => {
      const outside = await createTerritory(client, 'seed-containment-outside');
      await expect(insertRevision(client, outside, 1, OUTSIDE_BELLO)).rejects.toThrow(
        /not contained by the Bello municipal boundary/
      );

      // Inside point derived from the real boundary itself: guaranteed interior.
      const inside = await createTerritory(client, 'seed-containment-inside');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO territory_revisions (territory_id, revision_number, geom, author)
         SELECT $1, 1, ST_Buffer(ST_PointOnSurface(geom), 0.0002), 'integration-test'
         FROM reference_municipal_boundary WHERE id = 1
         RETURNING id`,
        [inside]
      );
      expect(Number(rows[0]?.id)).toBeGreaterThan(0);
    });
  });
});
