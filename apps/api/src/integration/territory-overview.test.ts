/**
 * The aggregation is where this feature's risk concentrates: month bucketing,
 * the definition of a visit, and the difference between "never worked" and
 * "nothing in this window". All of it is proven against real PostGIS.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '@territorios/geo/db/migrate';

import { ValidationError } from '../domain/errors.js';
import { getTerritoryOverview } from '../domain/territory-overview.js';

const IMAGE = 'postgis/postgis:16-3.4';

const SQUARE = {
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

// Fixture fix (not part of the three risk rules under test): the brief's
// createTerritory reuses one fixed SQUARE for every call. Unlike the other
// integration suites in this codebase (see progress-and-audit.test.ts),
// nothing here archives territories between tests, so a second active
// territory with the identical geometry trips the real unauthorized-overlap
// trigger on territory_revisions before the query under test ever runs.
// Archiving after every test was considered and rejected: the "ending with
// the current month" test intentionally has no createTerritory call of its
// own and depends on an earlier test's territory still being active. Instead
// each territory gets a small northward offset (well inside the fixture
// boundary envelope) so none of them overlap and every test's original
// assertions are exercised unchanged.
let squareOffset = 0;
function nextSquare(): typeof SQUARE {
  const shift = squareOffset * 0.01;
  squareOffset += 1;
  return {
    type: 'Polygon',
    coordinates: [
      SQUARE.coordinates[0]!.map(([lng, lat]) => [lng, lat + shift])
    ]
  };
}

const FIXTURE_BOUNDARY_SQL = `
  INSERT INTO reference_municipal_boundary (id, name, geom, source_url, retrieved_at, attribution)
  VALUES (1, 'Bello (test fixture envelope)',
          ST_Multi(ST_SetSRID(ST_MakeEnvelope(-75.70, 6.20, -75.40, 6.55), 4326)),
          'integration-test-fixture', now(), 'test fixture')
`;

let container: StartedPostgreSqlContainer;
let databaseUrl: string;
let pool: Pool;

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Creates a territory with one revision. Returns its id. */
async function createTerritory(name: string, number: string | null): Promise<number> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO territories (name, number) VALUES ($1, $2) RETURNING id`,
      [name, number]
    );
    const id = Number(rows[0]?.id);
    await client.query(
      `INSERT INTO territory_revisions (territory_id, revision_number, geom, author)
       VALUES ($1, 1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), 'admin')`,
      [id, JSON.stringify(nextSquare())]
    );
    return id;
  });
}

/** Records progress at an explicit Bogota local timestamp. */
async function recordProgressAt(territoryId: number, bogotaLocal: string): Promise<void> {
  await withClient((client) =>
    client.query(
      `INSERT INTO progress_entries (territory_id, recorded_by, recorded_at)
       VALUES ($1, 'worker', ($2::timestamp AT TIME ZONE 'America/Bogota'))`,
      [territoryId, bogotaLocal]
    )
  );
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(IMAGE)
    .withDatabase('territorios_overview_test')
    .withUsername('territorios')
    .withPassword('territorios')
    .withStartupTimeout(300_000)
    .start();
  databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);
  await withClient((client) => client.query(FIXTURE_BOUNDARY_SQL));
  pool = new Pool({ connectionString: databaseUrl, max: 5 });
}, 360_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// America/Bogota has been a fixed UTC-05:00 offset with no DST transitions
// since 1993, so "current Bogota calendar month" can be derived with a plain
// arithmetic shift instead of a timezone library — matching how the query
// under test buckets via `now() AT TIME ZONE 'America/Bogota'`.
function bogotaYearMonth(date: Date): { year: number; month: number } {
  const bogota = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  return { year: bogota.getUTCFullYear(), month: bogota.getUTCMonth() + 1 };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function monthKeyFromYearMonth(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

/** Last calendar day of the given 1-based month, e.g. lastDayOfMonth(2026, 2) === 28. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The Bogota calendar month immediately before the given one. */
function previousYearMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

describe('getTerritoryOverview', () => {
  it('counts two entries on the same day as one visit', async () => {
    const id = await createTerritory('same-day', 'S-1');
    const { year, month } = bogotaYearMonth(new Date());
    // Day 1 exists in every month, so this stays inside the current Bogota
    // month regardless of which day the suite happens to run on.
    const datePrefix = `${year}-${pad2(month)}-01`;
    await recordProgressAt(id, `${datePrefix} 09:00:00`);
    await recordProgressAt(id, `${datePrefix} 16:30:00`);

    const rows = await getTerritoryOverview(pool, { months: 12, includeArchived: false });
    const row = rows.find((candidate) => candidate.id === id);

    const currentMonth = row?.monthly.find((entry) => entry.month === monthKeyFromYearMonth(year, month));
    expect(currentMonth?.times).toBe(1);
  });

  it('keeps a 23:30 Bogota entry in its own month, not the next', async () => {
    const id = await createTerritory('timezone-edge', 'S-2');
    const current = bogotaYearMonth(new Date());
    const previous = previousYearMonth(current.year, current.month);
    const lastDay = lastDayOfMonth(previous.year, previous.month);
    // 23:30 Bogota on the last day of `previous` is 04:30 UTC on the first
    // day of `current`. Bucketing in UTC would file this under `current`
    // and the strip would lie.
    await recordProgressAt(id, `${previous.year}-${pad2(previous.month)}-${pad2(lastDay)} 23:30:00`);

    const rows = await getTerritoryOverview(pool, { months: 24, includeArchived: false });
    const row = rows.find((candidate) => candidate.id === id);

    expect(row?.monthly.find((entry) => entry.month === monthKeyFromYearMonth(previous.year, previous.month))?.times).toBe(1);
    expect(row?.monthly.find((entry) => entry.month === monthKeyFromYearMonth(current.year, current.month))?.times).toBe(0);
  });

  it('returns a territory with no progress at all, with zeros and a null lastWorkedAt', async () => {
    const id = await createTerritory('never-worked', 'S-3');

    const rows = await getTerritoryOverview(pool, { months: 12, includeArchived: false });
    const row = rows.find((candidate) => candidate.id === id);

    expect(row).toBeDefined();
    expect(row?.lastWorkedAt).toBeNull();
    expect(row?.monthly.every((month) => month.times === 0)).toBe(true);
  });

  it('separates "never worked" from "nothing in this window"', async () => {
    const id = await createTerritory('worked-long-ago', 'S-4');
    await recordProgressAt(id, '2020-01-15 10:00:00');

    const rows = await getTerritoryOverview(pool, { months: 12, includeArchived: false });
    const row = rows.find((candidate) => candidate.id === id);

    expect(row?.monthly.every((month) => month.times === 0)).toBe(true);
    expect(row?.lastWorkedAt).not.toBeNull();
    // ISO instant, not a session-timezone-dependent rendering — and the
    // date component must survive intact.
    expect(row?.lastWorkedAt).toMatch(/^2020-01-15/);
  });

  it('returns exactly `months` buckets, ending with the current month', async () => {
    const id = await createTerritory('window-shape', 'S-0');

    const rows = await getTerritoryOverview(pool, { months: 12, includeArchived: false });
    const row = rows.find((candidate) => candidate.id === id);

    expect(row?.monthly).toHaveLength(12);
    expect(row?.monthly.at(-1)?.month).toBe(monthKey(new Date()));
  });

  it('rejects a non-positive months option instead of silently returning an empty list', async () => {
    await expect(getTerritoryOverview(pool, { months: 0, includeArchived: false })).rejects.toThrow(ValidationError);
    await expect(getTerritoryOverview(pool, { months: -1, includeArchived: false })).rejects.toThrow(ValidationError);
  });

  it('excludes archived territories unless asked', async () => {
    const id = await createTerritory('archived-one', 'S-5');
    await withClient((client) => client.query(`UPDATE territories SET status = 'archived' WHERE id = $1`, [id]));

    const withoutArchived = await getTerritoryOverview(pool, { months: 12, includeArchived: false });
    expect(withoutArchived.find((candidate) => candidate.id === id)).toBeUndefined();

    const withArchived = await getTerritoryOverview(pool, { months: 12, includeArchived: true });
    expect(withArchived.find((candidate) => candidate.id === id)).toBeDefined();
  });

  it('reports area in hectares from the latest revision', async () => {
    const id = await createTerritory('area-check', 'S-6');

    const rows = await getTerritoryOverview(pool, { months: 12, includeArchived: false });
    const row = rows.find((candidate) => candidate.id === id);

    expect(row?.areaHectares).toBeGreaterThan(0);
    expect(row?.areaHectares).toBeLessThan(100);
  });
});
