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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { DEFAULT_MIGRATIONS_DIR, listMigrationFiles, runMigrations } from '../db/migrate.js';

const IMAGE = 'postgis/postgis:16-3.4';

// Geometry fixtures around the verified Bello sample vertex
// [-75.57307274994052, 6.358147322663799] (docs/map-references.md).
const VALID_SQUARE =
  'POLYGON((-75.574 6.357, -75.572 6.357, -75.572 6.359, -75.574 6.359, -75.574 6.357))';
const BOWTIE =
  'POLYGON((-75.574 6.357, -75.572 6.359, -75.572 6.357, -75.574 6.359, -75.574 6.357))';
const COLLINEAR = 'POLYGON((-75.574 6.357, -75.573 6.358, -75.572 6.359, -75.574 6.357))';
const COLLINEAR_LONG = 'POLYGON((-75.6 6.3, -75.55 6.35, -75.5 6.4, -75.6 6.3))';

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
}, 360_000);

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
      expect(tables.rows.map((row) => row.table_name)).toEqual(
        expect.arrayContaining([
          'assignments',
          'audit_events',
          'progress_entries',
          'schema_migrations',
          'share_tokens',
          'territories',
          'territory_revisions'
        ])
      );
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

describe('assignments reference a specific revision', () => {
  it('rejects an assignment whose revision belongs to another territory (composite FK)', async () => {
    await withClient(async (client) => {
      const territoryA = await createTerritory(client, 'fk-territory-a');
      const territoryB = await createTerritory(client, 'fk-territory-b');
      const revisionA = await insertRevision(client, territoryA, 1, VALID_SQUARE);

      try {
        await client.query(
          `INSERT INTO assignments (territory_id, territory_revision_id, assigned_to, assigned_by)
           VALUES ($1, $2, 'worker', 'admin')`,
          [territoryB, revisionA]
        );
        expect.unreachable('cross-territory revision reference was accepted');
      } catch (error) {
        const pgError = asPgError(error);
        expect(pgError.code).toBe('23503');
        expect(pgError.constraint).toBe('assignments_revision_belongs_to_territory');
      }
    });
  });

  it('rejects completion without a timestamp', async () => {
    await withClient(async (client) => {
      const territoryId = await createTerritory(client, 'completion-ts');
      const revisionId = await insertRevision(client, territoryId, 1, VALID_SQUARE);
      try {
        await client.query(
          `INSERT INTO assignments (territory_id, territory_revision_id, assigned_to, assigned_by, status)
           VALUES ($1, $2, 'worker', 'admin', 'completed')`,
          [territoryId, revisionId]
        );
        expect.unreachable('completed assignment without completed_at was accepted');
      } catch (error) {
        expect(asPgError(error).code).toBe('23514');
        expect(asPgError(error).constraint).toBe('assignments_completed_has_timestamp');
      }
    });
  });

  it('requires an auditable reason to reopen, and preserves the revision reference', async () => {
    await withClient(async (client) => {
      const territoryId = await createTerritory(client, 'reopen-reason');
      const revisionId = await insertRevision(client, territoryId, 1, VALID_SQUARE);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO assignments (territory_id, territory_revision_id, assigned_to, assigned_by, status, completed_at)
         VALUES ($1, $2, 'worker', 'admin', 'completed', now())
         RETURNING id`,
        [territoryId, revisionId]
      );
      const assignmentId = Number(rows[0]?.id);

      for (const reason of [undefined, '   ']) {
        try {
          await client.query(`UPDATE assignments SET status = 'active', reopen_reason = $2 WHERE id = $1`, [
            assignmentId,
            reason
          ]);
          expect.unreachable('reopen without a reason was accepted');
        } catch (error) {
          const pgError = asPgError(error);
          expect(pgError.code).toBe('P0001');
          expect(pgError.message).toMatch(/requires a reopen_reason/);
        }
      }

      await client.query(
        `UPDATE assignments SET status = 'active', reopen_reason = 'follow-up visit needed' WHERE id = $1`,
        [assignmentId]
      );
      const reopened = await client.query<{ status: string; territory_revision_id: string }>(
        'SELECT status, territory_revision_id FROM assignments WHERE id = $1',
        [assignmentId]
      );
      expect(reopened.rows[0]?.status).toBe('active');
      // AGENTS.md: reopening preserves the referenced geometry revision.
      expect(Number(reopened.rows[0]?.territory_revision_id)).toBe(revisionId);
    });
  });
});

describe('at most one active assignment per territory, under concurrency', () => {
  it('two concurrent transactions produce exactly one active assignment', async () => {
    const { territoryId, revisionId } = await withClient(async (client) => {
      const created = await createTerritory(client, 'concurrency-one-active');
      const revision = await insertRevision(client, created, 1, VALID_SQUARE);
      return { territoryId: created, revisionId: revision };
    });

    const first = new Client({ connectionString: databaseUrl });
    const second = new Client({ connectionString: databaseUrl });
    await first.connect();
    await second.connect();

    const assignInTransaction = async (client: Client, worker: string, holdMs: number) => {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO assignments (territory_id, territory_revision_id, assigned_to, assigned_by, status)
         VALUES ($1, $2, $3, 'admin', 'active')`,
        [territoryId, revisionId, worker]
      );
      // Hold the transaction open so the two writers genuinely overlap:
      // the loser blocks on the partial unique index until the winner commits.
      if (holdMs > 0) {
        await sleep(holdMs);
      }
      await client.query('COMMIT');
    };

    const results = await Promise.allSettled([
      assignInTransaction(first, 'worker-1', 750),
      assignInTransaction(second, 'worker-2', 0)
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
    expect(loserError.code).toBe('23505');
    expect(loserError.constraint).toBe('assignments_one_active_per_territory');

    const activeCount = await withClient(async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM assignments WHERE territory_id = $1 AND status = 'active'`,
        [territoryId]
      );
      return rows[0]?.n ?? -1;
    });

    // Verbatim evidence line for the handoff.
    console.log(
      `[concurrency] winner=1 loserSqlState=${loserError.code} loserConstraint=${loserError.constraint} activeAssignmentsForTerritory=${activeCount}`
    );

    expect(activeCount).toBe(1);
  });
});
