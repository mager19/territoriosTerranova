# Admin Territory Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the administrator one screen that shows, per territory, how consistently it has been worked over the last twelve months.

**Architecture:** A new read-only aggregation endpoint (`GET /admin/territories/overview`) computes per-territory, per-month visit counts in a single SQL query, bucketed in Bogota local time. A new admin view renders one row per territory with a twelve-block strip encoding those counts. A new nullable-unique `number` column on `territories` carries the congregation's own territory numbering.

**Tech Stack:** Fastify + node-postgres + PostGIS (API), React 19 + Vite (admin), Vitest everywhere, Testcontainers for integration tests.

**Spec:** `docs/superpowers/specs/2026-09-09-admin-overview-design.md`

## Global Constraints

These apply to every task. Do not restate them per task; do not violate them.

- **No percentage of coverage anywhere.** Progress is a LineString along a perimeter, not a fraction. Report counts and dates only. (AGENTS.md: coverage is never inferred.)
- **No volunteer names in this view.** `progress_entries.recorded_by` is never selected, aggregated, or rendered by anything in this plan.
- **UI copy is Spanish. Code, identifiers, comments, tests and commit messages are English.** This is the established repo convention.
- **Colours come from existing CSS custom properties in `apps/admin/src/styles.css`.** No new palette values.
- **Month buckets use `AT TIME ZONE 'America/Bogota'`.** Never UTC.
- **One visit = one distinct local calendar day with at least one progress entry.** Never a row count.
- **`lastWorkedAt` is all-time, never windowed.**
- **Migrations are forward-only and checksum-tracked.** Never edit an applied migration; add a new one.
- **Every commit message ends with this footer:**
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01YJm4jP8BjoNUdrMbxJL1mg
  ```
- **Full verification command** (run before declaring any task done that touches more than docs):
  ```bash
  pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration && pnpm build
  ```
  Integration tests need Docker running.

## File Structure

**Backend**
- `db/migrations/0005_territory_number.sql` — new. Adds the nullable unique `number` column.
- `apps/api/src/domain/territory-overview.ts` — new. The aggregation query and its row types. One responsibility: turn the database into overview rows.
- `apps/api/src/routes/admin/territory-overview.ts` — new. Query-param validation and HTTP shape.
- `apps/api/src/domain/errors.ts` — modify. Adds `DuplicateTerritoryNumberError`.
- `apps/api/src/db/pg-error-mapper.ts` — modify. Maps the unique violation to that error.
- `apps/api/src/routes/admin/error-response.ts` — modify. Maps that error to 409.
- `apps/api/src/domain/territories.ts` — modify. `number` on create; `setTerritoryNumber`.
- `apps/api/src/routes/admin/territories.ts` — modify. `number` in the create body; `PATCH .../number`.
- `apps/api/src/app.ts` — modify. Registers the overview routes.

**Frontend**
- `apps/admin/src/features/territory-overview/overview-format.ts` — new. Pure formatting: intensity level, month labels, relative time. No React, no fetch — this is the only frontend code in this plan that is unit tested.
- `apps/admin/src/features/territory-overview/MonthStrip.tsx` — new. Renders one twelve-block strip with its accessible label.
- `apps/admin/src/features/territory-overview/TerritoryOverview.tsx` — new. Fetches, holds filter/sort state, renders the table.
- `apps/admin/src/api/client.ts` — modify. Types, two new calls, one new error message.
- `apps/admin/src/App.tsx` — modify. View toggle.
- `apps/admin/src/styles.css` — modify. Table and strip styles.

---

### Task 1: Migration — territory number column

**Files:**
- Create: `db/migrations/0005_territory_number.sql`
- Test: `packages/geo/src/integration/db.test.ts` (add a describe block)

**Interfaces:**
- Consumes: nothing.
- Produces: `territories.number text UNIQUE NULL`, used by every later backend task.

- [ ] **Step 1: Write the migration**

Create `db/migrations/0005_territory_number.sql`:

```sql
-- 0005: The congregation's own territory number.
--
-- Nullable because territories created before this migration have no number
-- and one cannot be invented for them; they read as "—" until an
-- administrator assigns one. Postgres allows multiple NULLs under a UNIQUE
-- constraint, so un-numbered territories coexist.
--
-- text, not integer, so codes like 'N-04' remain possible. Callers order by
-- (length(number), number) to keep plain numbers in natural order.
--
-- Safe against the existing BEFORE UPDATE trigger on territories
-- (territories_overlap_on_reactivation, 0003): that trigger's WHEN clause
-- fires only when status changes to 'active', so writing a number does not
-- re-run the overlap check.

ALTER TABLE territories ADD COLUMN number text;

ALTER TABLE territories ADD CONSTRAINT territories_number_unique UNIQUE (number);
```

- [ ] **Step 2: Write the failing test**

In `packages/geo/src/integration/db.test.ts`, add this describe block immediately after the `describe('geometry constraints are enforced by the database', ...)` block closes:

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter @territorios/geo test:integration
```

Expected: FAIL — `column "number" of relation "territories" does not exist`.

- [ ] **Step 4: Run the test to verify it passes**

The migration written in Step 1 is picked up automatically by the test's `runMigrations` call, so no implementation step is needed beyond it.

```bash
pnpm --filter @territorios/geo test:integration
```

Expected: PASS, 28 tests.

- [ ] **Step 5: Apply the migration to the development database**

```bash
pnpm db:migrate
```

Expected: output naming `0005_territory_number.sql` as applied.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/0005_territory_number.sql packages/geo/src/integration/db.test.ts
git commit -m "feat(db): add the congregation's own territory number"
```

---

### Task 2: Duplicate-number domain error

**Files:**
- Modify: `apps/api/src/domain/errors.ts`
- Modify: `apps/api/src/db/pg-error-mapper.ts`
- Modify: `apps/api/src/routes/admin/error-response.ts`
- Test: `apps/api/src/db/pg-error-mapper.test.ts`

**Interfaces:**
- Consumes: the `territories_number_unique` constraint from Task 1.
- Produces: `DuplicateTerritoryNumberError` (code `'duplicate_territory_number'`), and `rethrowAsTerritoryNumberError(error: unknown): never`, both used by Task 3.

- [ ] **Step 1: Write the failing test**

In `apps/api/src/db/pg-error-mapper.test.ts`, add to the imports from `../domain/errors.js` the name `DuplicateTerritoryNumberError`, add `rethrowAsTerritoryNumberError` to the imports from `./pg-error-mapper.js`, and append:

```ts
describe('rethrowAsTerritoryNumberError', () => {
  it('maps the unique-violation on territories_number_unique', () => {
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'territories_number_unique'
    });

    expect(() => rethrowAsTerritoryNumberError(pgError)).toThrow(DuplicateTerritoryNumberError);
  });

  it('rethrows anything else untouched', () => {
    const other = new Error('connection terminated');

    expect(() => rethrowAsTerritoryNumberError(other)).toThrow('connection terminated');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @territorios/api test
```

Expected: FAIL — `rethrowAsTerritoryNumberError is not a function`.

- [ ] **Step 3: Add the error class**

In `apps/api/src/domain/errors.ts`, add this class next to the other error classes:

```ts
export class DuplicateTerritoryNumberError extends Error {
  readonly code = 'duplicate_territory_number' as const;
  constructor(number: string) {
    super(`territory number ${number} is already in use`);
    this.name = 'DuplicateTerritoryNumberError';
  }
}
```

Then add `DuplicateTerritoryNumberError` to the `DomainError` union type and add `error instanceof DuplicateTerritoryNumberError ||` to the `isDomainError` guard.

- [ ] **Step 4: Add the mapper**

In `apps/api/src/db/pg-error-mapper.ts`, import `DuplicateTerritoryNumberError` from `../domain/errors.js` and append:

```ts
/** A number collision is a real conflict with existing state, not bad input — see error-response.ts, which maps it to 409. */
export function rethrowAsTerritoryNumberError(error: unknown): never {
  if (isPgError(error) && error.code === '23505' && error.constraint === 'territories_number_unique') {
    throw new DuplicateTerritoryNumberError('requested');
  }
  throw error;
}
```

If the existing `isPgError` helper in this file is not exported, use it as-is from within the module; do not export it.

- [ ] **Step 5: Map it to a status code**

In `apps/api/src/routes/admin/error-response.ts`, add `case 'duplicate_territory_number':` immediately above `case 'unauthorized_overlap':` so both return 409. The switch is exhaustive over `DomainError['code']`, so omitting this is a compile error.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @territorios/api test && pnpm typecheck
```

Expected: PASS, 84 tests, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/domain/errors.ts apps/api/src/db/pg-error-mapper.ts apps/api/src/routes/admin/error-response.ts apps/api/src/db/pg-error-mapper.test.ts
git commit -m "feat(api): map a duplicate territory number to a 409"
```

---

### Task 3: Set and create territories with a number

**Files:**
- Modify: `apps/api/src/domain/territories.ts`
- Modify: `apps/api/src/routes/admin/territories.ts`
- Test: `apps/api/src/routes/admin/territories.test.ts`
- Test: `apps/api/src/integration/territories.test.ts`

**Interfaces:**
- Consumes: `DuplicateTerritoryNumberError`, `rethrowAsTerritoryNumberError` (Task 2).
- Produces:
  - `CreateTerritoryInput` gains `readonly number?: string`.
  - `Territory` and `TerritoryWithRevisions` gain `readonly number: string | null`.
  - `setTerritoryNumber(pool: TransactionalPool, territoryId: number, number: string): Promise<Territory>`.
  - `PATCH /admin/territories/:id/number` with body `{ number: string }`.

- [ ] **Step 1: Write the failing validation tests**

In `apps/api/src/routes/admin/territories.test.ts`, append:

```ts
describe('PATCH /admin/territories/:id/number — validation branches', () => {
  it('rejects a non-numeric id without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/admin/territories/abc/number',
      payload: { number: 'T-1' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects a blank number without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/admin/territories/1/number',
      payload: { number: '   ' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @territorios/api test
```

Expected: FAIL — both return 404 (route not registered) instead of 400.

- [ ] **Step 3: Add the domain function and widen the row types**

In `apps/api/src/domain/territories.ts`:

Add `readonly number: string | null;` to both the `Territory` and `TerritoryWithRevisions` interfaces, and `readonly number: string | null;` to the `TerritoryRow` interface.

Add `readonly number?: string;` to `CreateTerritoryInput`.

In `toTerritory`, add `number: row.number,` to the returned object.

In `createTerritory`, replace the `INSERT INTO territories` query and its surrounding statement with:

```ts
    const trimmedNumber = input.number?.trim();
    const { rows } = await (async () => {
      try {
        return await client.query<{ id: string; status: TerritoryStatus; created_at: string }>(
          `INSERT INTO territories (name, number) VALUES ($1, $2) RETURNING id, status, created_at`,
          [name, trimmedNumber === undefined || trimmedNumber === '' ? null : trimmedNumber]
        );
      } catch (error) {
        rethrowAsTerritoryNumberError(error);
      }
    })();
```

Import `rethrowAsTerritoryNumberError` alongside the existing `rethrowAsTerritoryGeometryError` import.

In `createTerritory`'s returned object, add `number: trimmedNumber === undefined || trimmedNumber === '' ? null : trimmedNumber,`.

In `getTerritoryWithRevisions`, add `number` to the selected columns and to the returned object, widening its inline row type with `number: string | null;`.

In `listTerritories`, add `t.number,` to the SELECT list.

Append this function:

```ts
/**
 * Sets or replaces a territory's number. `territories` is a mutable table
 * (only territory_revisions/progress_entries/audit_events are append-only),
 * and the one BEFORE UPDATE trigger on it fires solely on reactivation, so
 * this does not re-run the overlap check.
 *
 * No audit event is written: renaming a territory is not audited either, so
 * auditing numbering alone would be incoherent. See the design doc.
 */
export async function setTerritoryNumber(
  pool: TransactionalPool,
  territoryId: number,
  number: string
): Promise<Territory> {
  const trimmed = number.trim();
  if (trimmed === '') {
    throw new ValidationError('number must not be blank');
  }

  return withTransaction(pool, async (client) => {
    try {
      const { rows } = await client.query<TerritoryRow>(
        `UPDATE territories SET number = $2
         WHERE id = $1
         RETURNING id, name, number, status, created_at,
                   (SELECT max(r.revision_number) FROM territory_revisions r WHERE r.territory_id = territories.id)
                     AS current_revision_number`,
        [territoryId, trimmed]
      );
      const row = rows[0];
      if (!row) {
        throw new TerritoryNotFoundError(territoryId);
      }
      return toTerritory(row);
    } catch (error) {
      if (error instanceof TerritoryNotFoundError) throw error;
      rethrowAsTerritoryNumberError(error);
    }
  });
}
```

- [ ] **Step 4: Add the route**

In `apps/api/src/routes/admin/territories.ts`, add `setTerritoryNumber` to the imports from `../../domain/territories.js`, add `number: typeof body.number === 'string' ? body.number : undefined` to the `createTerritory` call's input object, and append this route inside `registerAdminTerritoryRoutes`:

```ts
  app.patch<{ Params: { id: string } }>('/admin/territories/:id/number', async (request, reply) => {
    const territoryId = Number(request.params.id);
    if (!Number.isInteger(territoryId) || territoryId < 1) {
      return reply.status(400).send({ error: 'invalid_request', message: 'territory id must be a positive integer' });
    }
    const body = isRecord(request.body) ? request.body : {};
    const number = typeof body.number === 'string' ? body.number.trim() : '';
    if (number === '') {
      return reply.status(400).send({ error: 'invalid_request', message: 'number must be a non-blank string' });
    }
    try {
      const territory = await setTerritoryNumber(deps.pool, territoryId, number);
      return reply.status(200).send(territory);
    } catch (error) {
      if (trySendDomainError(reply, error)) return;
      throw error;
    }
  });
```

- [ ] **Step 5: Run the validation tests to verify they pass**

```bash
pnpm --filter @territorios/api test
```

Expected: PASS, 86 tests.

- [ ] **Step 6: Write the integration test**

In `apps/api/src/integration/territories.test.ts`, append:

```ts
describe('territory numbering', () => {
  it('creates with a number, then changes it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: 'numbered-territory', geometry: VALID_SQUARE, author: 'admin-1', number: 'T-7' }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().number).toBe('T-7');

    const renumbered = await app.inject({
      method: 'PATCH',
      url: `/admin/territories/${created.json().id}/number`,
      payload: { number: 'T-8' }
    });
    expect(renumbered.statusCode).toBe(200);
    expect(renumbered.json().number).toBe('T-8');
  });

  it('refuses a number another territory already holds', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: 'holds-the-number', geometry: VALID_SQUARE, author: 'admin-1', number: 'T-9' }
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: 'wants-the-number', geometry: FAR_SQUARE, author: 'admin-1', number: 'T-9' }
    });

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: 'duplicate_territory_number' });
  });

  it('404s when numbering a territory that does not exist', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/admin/territories/999999/number',
      payload: { number: 'T-404' }
    });

    expect(response.statusCode).toBe(404);
  });
});
```

This test needs a second, non-overlapping polygon. If `FAR_SQUARE` is not already defined in this file, add it next to `VALID_SQUARE`:

```ts
const FAR_SQUARE = {
  type: 'Polygon',
  coordinates: [
    [
      [-75.560, 6.340],
      [-75.558, 6.340],
      [-75.558, 6.342],
      [-75.560, 6.342],
      [-75.560, 6.340]
    ]
  ]
};
```

- [ ] **Step 7: Run the integration tests**

```bash
pnpm --filter @territorios/api test:integration
```

Expected: PASS. Requires Docker.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/domain/territories.ts apps/api/src/routes/admin/territories.ts apps/api/src/routes/admin/territories.test.ts apps/api/src/integration/territories.test.ts
git commit -m "feat(api): create and update a territory's number"
```

---

### Task 4: The overview aggregation query

**Files:**
- Create: `apps/api/src/domain/territory-overview.ts`
- Test: `apps/api/src/integration/territory-overview.test.ts`

**Interfaces:**
- Consumes: `territories.number` (Task 1).
- Produces:
  ```ts
  export interface TerritoryOverviewMonth { readonly month: string; readonly times: number }
  export interface TerritoryOverviewRow {
    readonly id: number;
    readonly number: string | null;
    readonly name: string;
    readonly status: 'active' | 'archived';
    readonly areaHectares: number | null;
    readonly lastWorkedAt: string | null;
    readonly monthly: readonly TerritoryOverviewMonth[];
  }
  export function getTerritoryOverview(
    pool: TransactionalPool,
    options: { readonly months: number; readonly includeArchived: boolean }
  ): Promise<readonly TerritoryOverviewRow[]>
  ```
  Used by Task 5.

- [ ] **Step 1: Write the failing integration test**

Create `apps/api/src/integration/territory-overview.test.ts`:

```ts
/**
 * The aggregation is where this feature's risk concentrates: month bucketing,
 * the definition of a visit, and the difference between "never worked" and
 * "nothing in this window". All of it is proven against real PostGIS.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '@territorios/geo/db/migrate';

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
      [id, JSON.stringify(SQUARE)]
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

describe('getTerritoryOverview', () => {
  it('counts two entries on the same day as one visit', async () => {
    const id = await createTerritory('same-day', 'S-1');
    await recordProgressAt(id, '2026-09-05 09:00:00');
    await recordProgressAt(id, '2026-09-05 16:30:00');

    const rows = await getTerritoryOverview(pool, { months: 12, includeArchived: false });
    const row = rows.find((candidate) => candidate.id === id);

    const september = row?.monthly.find((month) => month.month === '2026-09');
    expect(september?.times).toBe(1);
  });

  it('keeps a 23:30 Bogota entry in its own month, not the next', async () => {
    const id = await createTerritory('timezone-edge', 'S-2');
    // 2026-08-31 23:30 Bogota is 2026-09-01 04:30 UTC. Bucketing in UTC
    // would file this under September and the strip would lie.
    await recordProgressAt(id, '2026-08-31 23:30:00');

    const rows = await getTerritoryOverview(pool, { months: 24, includeArchived: false });
    const row = rows.find((candidate) => candidate.id === id);

    expect(row?.monthly.find((month) => month.month === '2026-08')?.times).toBe(1);
    expect(row?.monthly.find((month) => month.month === '2026-09')?.times).toBe(0);
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
  });

  it('returns exactly `months` buckets, ending with the current month', async () => {
    const rows = await getTerritoryOverview(pool, { months: 12, includeArchived: false });
    const row = rows[0];

    expect(row?.monthly).toHaveLength(12);
    expect(row?.monthly.at(-1)?.month).toBe(monthKey(new Date()));
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
```

Note: the `monthKey` helper uses UTC parts, which is correct here only because it is comparing against a bucket label. If this test runs on a machine whose local date differs from Bogota's across a month boundary, this one assertion can be off by a month; that is a known and accepted limitation of asserting "now".

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @territorios/api test:integration
```

Expected: FAIL — cannot resolve `../domain/territory-overview.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/domain/territory-overview.ts`:

```ts
/**
 * Read-only aggregation behind the administrator's overview screen.
 *
 * Two rules this file exists to enforce, both of which would otherwise fail
 * silently:
 *
 * - A visit is a distinct LOCAL calendar day with at least one progress
 *   entry, never a row count. Someone recording a pause and a resume made
 *   one outing.
 * - Months are bucketed in America/Bogota. recorded_at is timestamptz, so
 *   bucketing in UTC would push a Sunday evening outing into the next month.
 *
 * lastWorkedAt is deliberately all-time rather than windowed: it is the only
 * thing that separates "never worked" from "nothing in the last N months".
 *
 * recorded_by is never selected here. This view speaks about territories,
 * not people (design doc, 2026-09-09).
 */

import { withTransaction, type TransactionalPool } from '../db/transaction.js';

export interface TerritoryOverviewMonth {
  readonly month: string;
  readonly times: number;
}

export interface TerritoryOverviewRow {
  readonly id: number;
  readonly number: string | null;
  readonly name: string;
  readonly status: 'active' | 'archived';
  readonly areaHectares: number | null;
  readonly lastWorkedAt: string | null;
  readonly monthly: readonly TerritoryOverviewMonth[];
}

interface OverviewDbRow {
  readonly id: string;
  readonly number: string | null;
  readonly name: string;
  readonly status: 'active' | 'archived';
  readonly area_hectares: string | null;
  readonly last_worked_at: string | null;
  readonly monthly: readonly TerritoryOverviewMonth[];
}

const TIME_ZONE = 'America/Bogota';

export interface TerritoryOverviewOptions {
  readonly months: number;
  readonly includeArchived: boolean;
}

export async function getTerritoryOverview(
  pool: TransactionalPool,
  options: TerritoryOverviewOptions
): Promise<readonly TerritoryOverviewRow[]> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<OverviewDbRow>(
      `WITH bounds AS (
         SELECT date_trunc('month', (now() AT TIME ZONE $3)) AS current_month
       ),
       months AS (
         SELECT to_char(m, 'YYYY-MM') AS month
         FROM bounds b,
              generate_series(
                b.current_month - make_interval(months => $1::int - 1),
                b.current_month,
                interval '1 month'
              ) AS m
       ),
       visits AS (
         SELECT p.territory_id,
                to_char(date_trunc('month', (p.recorded_at AT TIME ZONE $3)), 'YYYY-MM') AS month,
                count(DISTINCT (p.recorded_at AT TIME ZONE $3)::date) AS times
         FROM progress_entries p
         GROUP BY 1, 2
       )
       SELECT t.id,
              t.number,
              t.name,
              t.status,
              (SELECT max(p.recorded_at)::text
                 FROM progress_entries p
                WHERE p.territory_id = t.id) AS last_worked_at,
              (SELECT (ST_Area(r.geom::geography) / 10000.0)::text
                 FROM territory_revisions r
                WHERE r.territory_id = t.id
                ORDER BY r.revision_number DESC
                LIMIT 1) AS area_hectares,
              json_agg(
                json_build_object('month', mo.month, 'times', COALESCE(v.times, 0)::int)
                ORDER BY mo.month
              ) AS monthly
         FROM territories t
        CROSS JOIN months mo
         LEFT JOIN visits v ON v.territory_id = t.id AND v.month = mo.month
        WHERE ($2::boolean OR t.status = 'active')
        GROUP BY t.id, t.number, t.name, t.status
        ORDER BY length(t.number) NULLS LAST, t.number NULLS LAST, t.id`,
      [options.months, options.includeArchived, TIME_ZONE]
    );

    return rows.map((row) => ({
      id: Number(row.id),
      number: row.number,
      name: row.name,
      status: row.status,
      areaHectares: row.area_hectares === null ? null : Number(row.area_hectares),
      lastWorkedAt: row.last_worked_at,
      monthly: row.monthly
    }));
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @territorios/api test:integration
```

Expected: PASS, 7 new tests in `territory-overview.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/domain/territory-overview.ts apps/api/src/integration/territory-overview.test.ts
git commit -m "feat(api): aggregate per-territory monthly visit counts"
```

---

### Task 5: The overview route

**Files:**
- Create: `apps/api/src/routes/admin/territory-overview.ts`
- Create: `apps/api/src/routes/admin/territory-overview.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `getTerritoryOverview` (Task 4).
- Produces: `GET /admin/territories/overview?months=&includeArchived=` returning `{ territories: TerritoryOverviewRow[] }`. Consumed by Task 6.

**Routing note:** Fastify's router resolves static segments before parametric ones, so `/admin/territories/overview` does not collide with the existing `/admin/territories/:id`. Step 1 pins that with a test, because a regression here would surface as a confusing 400 about territory ids.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/routes/admin/territory-overview.test.ts`:

```ts
/**
 * Validation branches only, using the repo's poison-pool pattern: the pool
 * throws if connected to at all, proving these requests are rejected before
 * any database round trip. Real aggregation behaviour lives in
 * src/integration/territory-overview.test.ts.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../app.js';
import type { TransactionalPool } from '../../db/transaction.js';

const poisonPool: TransactionalPool = {
  connect: async () => {
    throw new Error('validation should have rejected this request before touching the database');
  }
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function buildTestApp(): Promise<FastifyInstance> {
  return buildApp({ queryPostgisVersion: async () => '3.4.3', pool: poisonPool }, { logger: false });
}

describe('GET /admin/territories/overview — validation branches', () => {
  it('rejects a non-numeric months without touching the database', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/admin/territories/overview?months=abc' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects months below 1', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/admin/territories/overview?months=0' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects months above 24', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/admin/territories/overview?months=25' });

    expect(response.statusCode).toBe(400);
  });

  it('does not fall through to the /admin/territories/:id route', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/admin/territories/overview?months=0' });

    // The :id handler's rejection message would be about territory ids.
    expect(response.json().message).not.toContain('territory id');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @territorios/api test
```

Expected: FAIL — the requests reach `/admin/territories/:id` and report a territory-id error, or 404.

- [ ] **Step 3: Write the route**

Create `apps/api/src/routes/admin/territory-overview.ts`:

```ts
/**
 * Administrator overview. Registered under /admin/territories/overview by
 * app.ts — a static segment, which Fastify's router resolves ahead of the
 * sibling /admin/territories/:id route.
 *
 * Deliberately a separate endpoint rather than an extension of
 * GET /admin/territories: that list exists to populate a selector and needs
 * only names, so making it carry a year of aggregates would slow the common
 * path for data it rarely needs.
 */

import type { FastifyInstance } from 'fastify';

import { getTerritoryOverview } from '../../domain/territory-overview.js';
import type { TransactionalPool } from '../../db/transaction.js';

export interface AdminTerritoryOverviewRouteDeps {
  readonly pool: TransactionalPool;
}

const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 24;

export function registerAdminTerritoryOverviewRoutes(
  app: FastifyInstance,
  deps: AdminTerritoryOverviewRouteDeps
): void {
  app.get<{ Querystring: { months?: string; includeArchived?: string } }>(
    '/admin/territories/overview',
    async (request, reply) => {
      const rawMonths = request.query.months;
      const months = rawMonths === undefined ? DEFAULT_MONTHS : Number(rawMonths);
      if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) {
        return reply
          .status(400)
          .send({ error: 'invalid_request', message: `months must be an integer between 1 and ${MAX_MONTHS}` });
      }

      const includeArchived = request.query.includeArchived === 'true';

      const territories = await getTerritoryOverview(deps.pool, { months, includeArchived });
      return reply.status(200).send({ territories });
    }
  );
}
```

- [ ] **Step 4: Register it**

In `apps/api/src/app.ts`, add the import next to the other admin route imports:

```ts
import { registerAdminTerritoryOverviewRoutes } from './routes/admin/territory-overview.js';
```

and inside the `if (deps.pool) {` block, add:

```ts
    registerAdminTerritoryOverviewRoutes(app, { pool: deps.pool });
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @territorios/api test
```

Expected: PASS, 90 tests.

- [ ] **Step 6: Verify against the live database**

With Docker and the API running (`pnpm dev` in another terminal):

```bash
curl -s "http://127.0.0.1:3000/admin/territories/overview?months=12" | head -c 400
```

Expected: JSON with a `territories` array; each entry has `monthly` with 12 buckets.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin/territory-overview.ts apps/api/src/routes/admin/territory-overview.test.ts apps/api/src/app.ts
git commit -m "feat(api): expose the territory overview endpoint"
```

---

### Task 6: Admin API client

**Files:**
- Modify: `apps/admin/src/api/client.ts`

**Interfaces:**
- Consumes: the endpoint from Task 5, `PATCH .../number` from Task 3.
- Produces:
  ```ts
  export interface TerritoryOverviewMonth { readonly month: string; readonly times: number }
  export interface TerritoryOverviewRow { id, number, name, status, areaHectares, lastWorkedAt, monthly }
  export function getTerritoryOverview(options?: { months?: number; includeArchived?: boolean }): Promise<{ territories: readonly TerritoryOverviewRow[] }>
  export function setTerritoryNumber(territoryId: number, number: string): Promise<Territory>
  ```
  Used by Task 9.

- [ ] **Step 1: Add the types and calls**

In `apps/admin/src/api/client.ts`, add `readonly number: string | null;` to the `Territory` interface, then append before the `ERROR_MESSAGES_ES` block:

```ts
export interface TerritoryOverviewMonth {
  readonly month: string;
  readonly times: number;
}

/** One row of the administrator's overview. Deliberately carries no volunteer identity — this view speaks about territories, not people. */
export interface TerritoryOverviewRow {
  readonly id: number;
  readonly number: string | null;
  readonly name: string;
  readonly status: 'active' | 'archived';
  readonly areaHectares: number | null;
  /** All-time, never windowed: this is what separates "never worked" from "nothing in the visible months". */
  readonly lastWorkedAt: string | null;
  readonly monthly: readonly TerritoryOverviewMonth[];
}

export function getTerritoryOverview(
  options: { months?: number; includeArchived?: boolean } = {}
): Promise<{ territories: readonly TerritoryOverviewRow[] }> {
  const params = new URLSearchParams();
  if (options.months !== undefined) params.set('months', String(options.months));
  if (options.includeArchived) params.set('includeArchived', 'true');
  const query = params.toString();
  return request(`/admin/territories/overview${query === '' ? '' : `?${query}`}`);
}

export function setTerritoryNumber(territoryId: number, number: string): Promise<Territory> {
  return request(`/admin/territories/${territoryId}/number`, {
    method: 'PATCH',
    body: JSON.stringify({ number })
  });
}
```

Then add this entry to `ERROR_MESSAGES_ES`:

```ts
  duplicate_territory_number: 'Ese número ya lo tiene otro territorio.',
```

Finally, add `number?: string;` to the `createTerritory` input type.

- [ ] **Step 2: Verify it compiles**

```bash
pnpm typecheck && pnpm lint
```

Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/api/client.ts
git commit -m "feat(admin): client bindings for the overview and territory number"
```

---

### Task 7: Pure formatting helpers

**Files:**
- Create: `apps/admin/src/features/territory-overview/overview-format.ts`
- Test: `apps/admin/src/features/territory-overview/overview-format.test.ts`

**Interfaces:**
- Consumes: `TerritoryOverviewMonth` (Task 6).
- Produces:
  ```ts
  export function intensityLevel(times: number): 0 | 1 | 2 | 3
  export function monthLabel(month: string): string
  export function describeLastWorked(lastWorkedAt: string | null, now: Date): string
  export function formatHectares(areaHectares: number | null): string
  ```
  Used by Tasks 8 and 9.

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/src/features/territory-overview/overview-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { describeLastWorked, formatHectares, intensityLevel, monthLabel } from './overview-format.js';

describe('intensityLevel', () => {
  it('maps a count to one of four levels', () => {
    expect(intensityLevel(0)).toBe(0);
    expect(intensityLevel(1)).toBe(1);
    expect(intensityLevel(2)).toBe(2);
    expect(intensityLevel(3)).toBe(2);
    expect(intensityLevel(4)).toBe(3);
    expect(intensityLevel(40)).toBe(3);
  });

  it('treats a negative count as empty rather than throwing', () => {
    expect(intensityLevel(-1)).toBe(0);
  });
});

describe('monthLabel', () => {
  it('renders a YYYY-MM key in Spanish', () => {
    expect(monthLabel('2026-07')).toBe('julio 2026');
    expect(monthLabel('2026-01')).toBe('enero 2026');
    expect(monthLabel('2026-12')).toBe('diciembre 2026');
  });

  it('returns the raw key unchanged when it is not a valid month', () => {
    expect(monthLabel('nonsense')).toBe('nonsense');
    expect(monthLabel('2026-13')).toBe('2026-13');
  });
});

describe('describeLastWorked', () => {
  const now = new Date('2026-09-09T12:00:00Z');

  it('says never when there is no record at all', () => {
    expect(describeLastWorked(null, now)).toBe('nunca');
  });

  it('says today for the same day', () => {
    expect(describeLastWorked('2026-09-09T08:00:00Z', now)).toBe('hoy');
  });

  it('counts days in the singular and the plural', () => {
    expect(describeLastWorked('2026-09-08T08:00:00Z', now)).toBe('hace 1 día');
    expect(describeLastWorked('2026-09-04T08:00:00Z', now)).toBe('hace 5 días');
  });

  it('switches to months past thirty days', () => {
    expect(describeLastWorked('2026-08-05T08:00:00Z', now)).toBe('hace 1 mes');
    expect(describeLastWorked('2026-06-05T08:00:00Z', now)).toBe('hace 3 meses');
  });
});

describe('formatHectares', () => {
  it('renders two decimals with a unit', () => {
    expect(formatHectares(0.196)).toBe('0.20 ha');
    expect(formatHectares(12)).toBe('12.00 ha');
  });

  it('renders an em dash when the area is unknown', () => {
    expect(formatHectares(null)).toBe('—');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @territorios/admin test
```

Expected: FAIL — cannot resolve `./overview-format.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/admin/src/features/territory-overview/overview-format.ts`:

```ts
/**
 * Pure formatting for the overview. Kept apart from the components so it can
 * be unit tested — the admin app has no component-test harness, so this is
 * the layer where the view's real logic is proven.
 *
 * Month names are a hardcoded array rather than Intl/toLocaleString: Node's
 * locale data varies with the ICU build, which would make these tests pass or
 * fail depending on the machine.
 */

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre'
];

/** Four levels, because the strip encodes counts as colour and more steps than this stop being distinguishable at 12px. */
export function intensityLevel(times: number): 0 | 1 | 2 | 3 {
  if (times <= 0) return 0;
  if (times === 1) return 1;
  if (times <= 3) return 2;
  return 3;
}

export function monthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const year = match[1];
  const monthIndex = Number(match[2]) - 1;
  const name = MONTH_NAMES[monthIndex];
  if (name === undefined) return month;
  return `${name} ${year}`;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function describeLastWorked(lastWorkedAt: string | null, now: Date): string {
  if (lastWorkedAt === null) return 'nunca';
  const then = new Date(lastWorkedAt);
  if (Number.isNaN(then.getTime())) return 'nunca';

  const days = Math.floor((now.getTime() - then.getTime()) / MILLISECONDS_PER_DAY);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'hace 1 día';
  if (days < 30) return `hace ${days} días`;

  const months = Math.floor(days / 30);
  return months === 1 ? 'hace 1 mes' : `hace ${months} meses`;
}

export function formatHectares(areaHectares: number | null): string {
  if (areaHectares === null) return '—';
  return `${areaHectares.toFixed(2)} ha`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @territorios/admin test
```

Expected: PASS, 45 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/territory-overview/overview-format.ts apps/admin/src/features/territory-overview/overview-format.test.ts
git commit -m "feat(admin): pure formatting for the territory overview"
```

---

### Task 8: The twelve-month strip

**Files:**
- Create: `apps/admin/src/features/territory-overview/MonthStrip.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: `intensityLevel`, `monthLabel` (Task 7); `TerritoryOverviewMonth` (Task 6).
- Produces: `<MonthStrip monthly={...} />`. Used by Task 9.

There is no component-test harness in this app, so this task is verified by typecheck, lint, build, and an explicit visual check. That is a stated gap in the design doc, not an oversight.

- [ ] **Step 1: Write the component**

Create `apps/admin/src/features/territory-overview/MonthStrip.tsx`:

```tsx
import type { JSX } from 'react';

import { intensityLevel, monthLabel } from './overview-format.js';
import type { TerritoryOverviewMonth } from '../../api/client.js';

export interface MonthStripProps {
  readonly monthly: readonly TerritoryOverviewMonth[];
}

/**
 * Twelve blocks, oldest to newest, encoding visits per month as colour
 * intensity. This is the whole point of the overview: a single month's count
 * cannot show consistency, a series can.
 *
 * The strip encodes numbers as colour, and this app's definition of done
 * requires keyboard and screen-reader operability — so it carries role="img"
 * with the series stated in words. Without that the information would exist
 * only for sighted users.
 */
export function MonthStrip({ monthly }: MonthStripProps): JSX.Element {
  const spoken = monthly.map((month) => `${monthLabel(month.month)}: ${month.times}`).join(', ');

  return (
    <span className="month-strip" role="img" aria-label={`Actividad mensual — ${spoken}`}>
      {monthly.map((month) => (
        <span
          key={month.month}
          className={`month-strip-block level-${intensityLevel(month.times)}`}
          title={`${monthLabel(month.month)}: ${month.times === 1 ? '1 vez' : `${month.times} veces`}`}
        />
      ))}
    </span>
  );
}
```

- [ ] **Step 2: Add the styles**

Append to `apps/admin/src/styles.css`:

```css
/* Overview: the twelve-month activity strip. Four steps only — more stop
   being distinguishable at this size. Colours come from the existing tokens;
   no new palette values. */
.month-strip {
  display: inline-flex;
  gap: 2px;
  align-items: center;
}

.month-strip-block {
  width: 10px;
  height: 16px;
  border-radius: 2px;
  border: 1px solid var(--color-ash);
  background: transparent;
}

.month-strip-block.level-1 {
  background: var(--color-periwinkle-mist);
  border-color: var(--color-periwinkle-mist);
}

.month-strip-block.level-2 {
  background: var(--color-lake-blue);
  border-color: var(--color-lake-blue);
  opacity: 0.55;
}

.month-strip-block.level-3 {
  background: var(--color-lake-blue);
  border-color: var(--color-lake-blue);
}
```

If any of `--color-ash`, `--color-periwinkle-mist` or `--color-lake-blue` is not defined in this file, stop and report it rather than inventing a colour.

- [ ] **Step 3: Verify it compiles**

```bash
pnpm typecheck && pnpm lint && pnpm build
```

Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/features/territory-overview/MonthStrip.tsx apps/admin/src/styles.css
git commit -m "feat(admin): twelve-month activity strip"
```

---

### Task 9: The overview table

**Files:**
- Create: `apps/admin/src/features/territory-overview/TerritoryOverview.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: `getTerritoryOverview`, `TerritoryOverviewRow`, `ApiError`, `describeApiError` (Task 6); `MonthStrip` (Task 8); `describeLastWorked`, `formatHectares`, `monthLabel` (Task 7).
- Produces: `<TerritoryOverview />`. Used by Task 10.

- [ ] **Step 1: Write the component**

Create `apps/admin/src/features/territory-overview/TerritoryOverview.tsx`:

```tsx
import { useEffect, useMemo, useState, type JSX } from 'react';

import { ApiError, describeApiError, getTerritoryOverview, type TerritoryOverviewRow } from '../../api/client.js';
import { MonthStrip } from './MonthStrip.js';
import { describeLastWorked, formatHectares, monthLabel } from './overview-format.js';

const MONTHS = 12;

type AttentionFilter = 'all' | 'none-in-month' | 'never';
type SortKey = 'number' | 'times' | 'lastWorked';

/**
 * The administrator's oversight view: one row per territory, with how often
 * it was worked each month for the last year.
 *
 * It deliberately reports counts and dates, never a percentage of coverage —
 * progress is a line along a perimeter, not a fraction, and inferring one
 * would be exactly what AGENTS.md forbids. It also names no volunteers: the
 * work belongs to the group, which is why individual assignment was removed
 * in the first place.
 *
 * The selected month is derived client-side from the monthly series rather
 * than refetched, so changing months is instant and one number never has two
 * definitions.
 */
export function TerritoryOverview(): JSX.Element {
  const [rows, setRows] = useState<readonly TerritoryOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [attention, setAttention] = useState<AttentionFilter>('all');
  // 'number' means "leave the server's ordering alone" — it already sorts by
  // (length(number), number) with un-numbered territories last, which no
  // client-side comparator would reproduce as well.
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: 'number', ascending: true });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTerritoryOverview({ months: MONTHS, includeArchived })
      .then((result) => {
        if (cancelled) return;
        setRows(result.territories);
        const latest = result.territories[0]?.monthly.at(-1)?.month ?? null;
        setSelectedMonth((current) => current ?? latest);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudo cargar el resumen.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [includeArchived]);

  const availableMonths = rows[0]?.monthly.map((month) => month.month) ?? [];

  function timesInSelectedMonth(row: TerritoryOverviewRow): number {
    if (selectedMonth === null) return 0;
    return row.monthly.find((month) => month.month === selectedMonth)?.times ?? 0;
  }

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (attention === 'never') return row.lastWorkedAt === null;
      if (attention === 'none-in-month') return timesInSelectedMonth(row) === 0;
      return true;
    });

    if (sort.key === 'number') return filtered;

    const direction = sort.ascending ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === 'times') {
        return (timesInSelectedMonth(a) - timesInSelectedMonth(b)) * direction;
      }
      // A territory never worked is the most stale thing there is, so it sorts
      // as older than any real date rather than being pushed to the end.
      const aTime = a.lastWorkedAt === null ? -Infinity : new Date(a.lastWorkedAt).getTime();
      const bTime = b.lastWorkedAt === null ? -Infinity : new Date(b.lastWorkedAt).getTime();
      if (aTime === bTime) return 0;
      return (aTime < bTime ? -1 : 1) * direction;
    });
    // timesInSelectedMonth closes over selectedMonth, which is in the deps.
  }, [rows, attention, selectedMonth, sort]);

  function toggleSort(key: SortKey): void {
    setSort((current) => (current.key === key ? { key, ascending: !current.ascending } : { key, ascending: true }));
  }

  function sortIndicator(key: SortKey): string {
    if (sort.key !== key) return '';
    return sort.ascending ? ' ↑' : ' ↓';
  }

  const nothingRecordedAnywhere = rows.length > 0 && rows.every((row) => row.lastWorkedAt === null);

  return (
    <section aria-labelledby="overview-heading">
      <h2 id="overview-heading">Resumen de territorios</h2>

      <div role="group" aria-label="Filtros del resumen" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <label htmlFor="overview-month">
          Mes
          <select
            id="overview-month"
            value={selectedMonth ?? ''}
            onChange={(event) => setSelectedMonth(event.target.value)}
            disabled={availableMonths.length === 0}
          >
            {availableMonths.map((month) => (
              <option key={month} value={month}>
                {monthLabel(month)}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="overview-attention">
          Mostrar
          <select
            id="overview-attention"
            value={attention}
            onChange={(event) => setAttention(event.target.value as AttentionFilter)}
          >
            <option value="all">Todos</option>
            <option value="none-in-month">Sin registros en el mes</option>
            <option value="never">Nunca trabajados</option>
          </select>
        </label>

        <label htmlFor="overview-archived">
          <input
            id="overview-archived"
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          Incluir archivados
        </label>
      </div>

      {loading && <p role="status">Cargando resumen…</p>}
      {error && (
        <p role="alert" className="editor-error">
          {error}
        </p>
      )}

      {!loading && !error && rows.length === 0 && <p>Todavía no hay territorios.</p>}

      {!loading && !error && nothingRecordedAnywhere && (
        <p role="status">
          Ningún territorio tiene progreso registrado todavía. Por ahora el progreso solo lo puede registrar el
          administrador, desde cada territorio.
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <table className="overview-table">
          <thead>
            <tr>
              <th scope="col">
                <button type="button" onClick={() => toggleSort('number')}>
                  Nº{sortIndicator('number')}
                </button>
              </th>
              <th scope="col">Territorio</th>
              <th
                scope="col"
                aria-sort={sort.key === 'times' ? (sort.ascending ? 'ascending' : 'descending') : 'none'}
              >
                <button type="button" onClick={() => toggleSort('times')}>
                  Veces en {selectedMonth === null ? 'el mes' : monthLabel(selectedMonth)}
                  {sortIndicator('times')}
                </button>
              </th>
              <th scope="col">Últimos {MONTHS} meses</th>
              <th
                scope="col"
                aria-sort={sort.key === 'lastWorked' ? (sort.ascending ? 'ascending' : 'descending') : 'none'}
              >
                <button type="button" onClick={() => toggleSort('lastWorked')}>
                  Última vez{sortIndicator('lastWorked')}
                </button>
              </th>
              <th scope="col">Tamaño</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id}>
                <td>{row.number ?? '—'}</td>
                <td>{row.name}</td>
                <td>{timesInSelectedMonth(row)}</td>
                <td>
                  <MonthStrip monthly={row.monthly} />
                </td>
                <td>{describeLastWorked(row.lastWorkedAt, new Date())}</td>
                <td>{formatHectares(row.areaHectares)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && !error && rows.length > 0 && visibleRows.length === 0 && (
        <p role="status">Ningún territorio coincide con ese filtro.</p>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Add the table styles**

Append to `apps/admin/src/styles.css`:

```css
/* Overview table. Borders only, no shadows, matching the rest of the admin. */
.overview-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.75rem;
}

.overview-table th,
.overview-table td {
  text-align: left;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--color-ash);
  vertical-align: middle;
}

.overview-table th {
  font-weight: 500;
}

/* Sortable headers are real buttons so they stay keyboard-operable, but they
   should not look like the pill buttons used for actions elsewhere. */
.overview-table th button {
  appearance: none;
  background: none;
  border: none;
  border-radius: 0;
  padding: 0;
  min-height: 0;
  font: inherit;
  font-weight: 500;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
```

- [ ] **Step 3: Verify it compiles**

```bash
pnpm typecheck && pnpm lint && pnpm build
```

Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/features/territory-overview/TerritoryOverview.tsx apps/admin/src/styles.css
git commit -m "feat(admin): territory overview table with month filters"
```

---

### Task 10: Wire the view into the app

**Files:**
- Modify: `apps/admin/src/App.tsx`
- Test: `apps/admin/src/App.test.tsx`

**Interfaces:**
- Consumes: `<TerritoryOverview />` (Task 9).
- Produces: nothing downstream. This is the last task.

- [ ] **Step 1: Write the failing test**

Replace the second test in `apps/admin/src/App.test.tsx` with:

```tsx
  it('renders the territory list and editor sections', () => {
    const html = renderToStaticMarkup(<App />);

    // Not the bare word "Territorios": that also appears in the page heading
    // ("Gestión de Territorios — Administración"), so this assertion used to
    // pass even with the list deleted.
    expect(html).toContain('Dibujar un territorio nuevo');
    expect(html).toContain('Cargando territorios…');
  });

  it('offers a way to switch to the overview', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('Resumen');
  });
```

- [ ] **Step 2: Run the tests to verify the new one fails**

```bash
pnpm --filter @territorios/admin test
```

Expected: FAIL on `offers a way to switch to the overview` — "Resumen" is not rendered yet.

- [ ] **Step 3: Add the view toggle**

In `apps/admin/src/App.tsx`:

Add the import:

```tsx
import { TerritoryOverview } from './features/territory-overview/TerritoryOverview.js';
```

Add the state next to the existing `useState` calls:

```tsx
  const [view, setView] = useState<'territories' | 'overview'>('territories');
```

Immediately after the `<h1>` element, add:

```tsx
      <nav aria-label="Vistas" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button type="button" onClick={() => setView('territories')} aria-current={view === 'territories'}>
          Territorios
        </button>
        <button type="button" onClick={() => setView('overview')} aria-current={view === 'overview'}>
          Resumen
        </button>
      </nav>
```

Then wrap the existing `<TerritoryList>`, `<TerritoryEditor>` and the conditional `<TerritoryDetail>` in `{view === 'territories' && (<> ... </>)}`, and add after that block:

```tsx
      {view === 'overview' && <TerritoryOverview />}
```

Update the component's doc comment to note that the app now has two views held in local state rather than a router, because two views do not justify the dependency, and that the tradeoff is that the overview has no URL of its own.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @territorios/admin test
```

Expected: PASS, 47 tests.

- [ ] **Step 5: Full verification**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration && pnpm build
```

Expected: all clean. Requires Docker.

- [ ] **Step 6: Verify in the browser**

With `pnpm dev` running, open `http://127.0.0.1:5173`, hard-reload, and check:

1. A "Resumen" button appears next to "Territorios".
2. Clicking it shows the table with one row per territory.
3. Territories created before this feature show "—" in the Nº column.
4. With no progress recorded anywhere, the explanatory line appears rather than a wall of zeros.
5. Changing the month selector updates the "Veces en …" column without a network request (check the Network tab).
6. The strip renders twelve blocks and hovering one shows its month and count.
7. Clicking "Veces en …" and "Última vez" sorts the table, and clicking the
   same header again reverses it. Sorting by "Última vez" ascending puts
   never-worked territories first.
8. Tab reaches the sortable headers and Enter activates them.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/App.tsx apps/admin/src/App.test.tsx
git commit -m "feat(admin): switch between the territory editor and the overview"
```

---

## Self-review notes

Checked against the spec on 2026-09-09:

- Every spec section maps to a task: numbering → 1–3, aggregation → 4, endpoint → 5, client → 6, formatting → 7, strip → 8, table/filters/sorting/empty states → 9, placement → 10.
- **One gap was found and fixed during this review:** the spec asks for sortable headers on times-in-month and last-worked, and no task implemented them. Sorting was added to Task 9, including `aria-sort` and keyboard-operable header buttons. Null `lastWorkedAt` sorts as older than any real date, so "nunca trabajado" leads an ascending sort rather than being stranded at the end.
- Verified against the live database before writing: `progress_entries` requires only `territory_id` and `recorded_by` (so Task 4's fixture inserts are valid), `number` is not a reserved word in Postgres, and `--color-ash`, `--color-periwinkle-mist` and `--color-lake-blue` all exist in `styles.css`.
- The spec's four correctness rules each have a test: distinct-day counting (Task 4 step 1), Bogota bucketing (Task 4 step 1), all-time `lastWorkedAt` (Task 4 step 1), `NULLS LAST` ordering (Task 4 implementation, exercised by Task 4's ordering-independent assertions).
- Names used across tasks are consistent: `getTerritoryOverview`, `TerritoryOverviewRow`, `TerritoryOverviewMonth`, `intensityLevel`, `monthLabel`, `describeLastWorked`, `formatHectares`, `MonthStrip`, `setTerritoryNumber`.
- Known gap, carried from the spec rather than hidden: no React component tests. Tasks 8, 9 and part of 10 are verified by typecheck, lint, build and an explicit browser checklist.
