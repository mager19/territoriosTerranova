/**
 * Progress entries — belong directly to a territory (2026-09-08: territories
 * are shared to a group, not assigned to one person; see
 * db/migrations/0004_remove_individual_assignment.sql). Append-only (A2's
 * trigger rejects UPDATE/DELETE/TRUNCATE on progress_entries, mirroring
 * territory_revisions); this layer never attempts to mutate one, only
 * insert.
 *
 * AGENTS.md, restated as the load-bearing rule of this module: coverage is
 * NEVER inferred from a territory polygon. An absent remaining-area
 * geometry means UNKNOWN — this module represents that as an explicit
 * `remainingAreaStatus: 'unknown'` alongside a `null` geometry, never as a
 * computed "rest of the territory" shape.
 *
 * Coverage sessions (2026-09-26, db/migrations/0007_progress_covered_area.sql):
 * every new entry carries the area COVERED in that session; the server
 * derives the new remaining area as (previous remaining area of the current
 * cycle) MINUS (covered area), inside the same transaction and under the
 * territory row lock. The first session of a cycle with no remaining area
 * requires an explicit 'whole_territory' baseline — the only way the
 * territory polygon ever becomes a remaining area, and it is recorded
 * immutably on the entry and in the audit payload.
 */

import type { LineString, MultiPolygon, Point, Polygon } from '@territorios/geo';
import type { PoolClient } from 'pg';

import { recordAuditEvent } from './audit.js';
import {
  BaselineRequiredError,
  CoveredAreaNotRemainingError,
  InvalidGeometryError,
  OutOfBoundsError,
  TerritoryNotFoundError,
  TerritoryNotOpenError,
  ValidationError,
  ZeroAreaGeometryError
} from './errors.js';
import {
  validateCoveredArea,
  validateOptionalBaseline,
  validateOptionalPausePoint,
  validateOptionalRoute,
  type CoverageBaseline
} from './geometry.js';
import { rethrowAsProgressEntryError } from '../db/pg-error-mapper.js';
import { withTransaction, type TransactionalPool } from '../db/transaction.js';

/**
 * Same measured zero-area epsilon (deg^2) as the DB constraints in
 * db/migrations/0002 and 0007 — used here only to reject BEFORE the insert
 * with a message that names the cause.
 */
const AREA_EPSILON = 1e-12;

/** Latest operational actions under which the territory is open for recording (paused kept for backward compatibility). */
const OPEN_ACTIONS: ReadonlySet<string> = new Set(['in_progress', 'reopened', 'paused']);

export interface ProgressEntry {
  readonly id: number;
  readonly territoryId: number;
  /** Operational cycle the entry was recorded in; null only for entries that predate operational cycles. */
  readonly cycleNumber: number | null;
  readonly recordedBy: string;
  readonly recordedAt: string;
  readonly note: string | null;
  readonly pausePoint: Point | null;
  readonly route: LineString | null;
  /** The area covered in this session. Null only on entries recorded before coverage sessions existed. */
  readonly coveredArea: Polygon | MultiPolygon | null;
  /** Explicit baseline the administrator confirmed for the first session of a cycle, else null. */
  readonly baseline: CoverageBaseline | null;
  /**
   * Remaining area after this entry. An EMPTY polygon (`coordinates: []`)
   * means "nothing left" (0% remaining); null means UNKNOWN.
   */
  readonly remainingArea: Polygon | MultiPolygon | null;
  /** Explicit, never-inferred marker: 'unknown' means the geometry was not recorded, not "fully covered". */
  readonly remainingAreaStatus: 'recorded' | 'unknown';
}

interface ProgressEntryRow {
  readonly id: string;
  readonly territory_id: string;
  readonly cycle_number: number | null;
  readonly recorded_by: string;
  readonly recorded_at: string;
  readonly note: string | null;
  readonly pause_point: Point | null;
  readonly route: LineString | null;
  readonly covered_area: Polygon | MultiPolygon | null;
  readonly baseline: CoverageBaseline | null;
  readonly remaining_area: Polygon | MultiPolygon | null;
}

function toProgressEntry(row: ProgressEntryRow): ProgressEntry {
  return {
    id: Number(row.id),
    territoryId: Number(row.territory_id),
    cycleNumber: row.cycle_number,
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at,
    note: row.note,
    pausePoint: row.pause_point,
    route: row.route,
    coveredArea: row.covered_area,
    baseline: row.baseline,
    remainingArea: row.remaining_area,
    remainingAreaStatus: row.remaining_area === null ? 'unknown' : 'recorded'
  };
}

/**
 * Every column the admin DTO needs, plus the cycle each entry belongs to:
 * the latest operational event recorded no later than the entry. Admin
 * only — covered_area is never selected by any public query.
 */
const PROGRESS_SELECT = `
  SELECT pe.id, pe.territory_id, cycle.cycle_number, pe.recorded_by, pe.recorded_at, pe.note,
         ST_AsGeoJSON(pe.pause_point)::json AS pause_point,
         ST_AsGeoJSON(pe.route)::json AS route,
         ST_AsGeoJSON(pe.covered_area)::json AS covered_area,
         pe.baseline,
         ST_AsGeoJSON(pe.remaining_area)::json AS remaining_area
  FROM progress_entries pe
  LEFT JOIN LATERAL (
    SELECT cycle_number
    FROM territory_operational_events
    WHERE territory_id = pe.territory_id AND created_at <= pe.recorded_at
    ORDER BY id DESC
    LIMIT 1
  ) cycle ON TRUE
`;

export interface RecordProgressInput {
  readonly recordedBy: string;
  readonly note?: string;
  readonly coveredArea?: unknown;
  readonly baseline?: unknown;
  readonly pausePoint?: unknown;
  readonly route?: unknown;
  /** Never accepted from a client: the remaining area is derived server-side. Present only to reject it explicitly. */
  readonly remainingArea?: unknown;
}

function toGeoJsonParam(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

/**
 * Validity and area are PostGIS's call (the application never re-implements
 * them), but they are checked explicitly here so the rejection names the
 * field — and before any spatial predicate, which can raise a GEOS
 * exception on invalid input.
 */
async function assertSessionGeometriesValid(
  client: PoolClient,
  coveredArea: string,
  route: string | null
): Promise<void> {
  const { rows } = await client.query<{
    covered_valid: boolean;
    covered_reason: string;
    covered_area: number;
    route_valid: boolean | null;
  }>(
    `SELECT ST_IsValid(c) AS covered_valid,
            ST_IsValidReason(c) AS covered_reason,
            ST_Area(c) AS covered_area,
            CASE WHEN $2::text IS NULL THEN NULL ELSE ST_IsValid(ST_GeomFromGeoJSON($2)) END AS route_valid
     FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS c) input`,
    [coveredArea, route]
  );
  const row = rows[0];
  if (!row) throw new Error('covered-area validity query returned no row');
  if (!row.covered_valid) {
    throw new InvalidGeometryError(`covered-area geometry is not a valid, simple polygon (${row.covered_reason})`);
  }
  if (!(row.covered_area > AREA_EPSILON)) {
    throw new ZeroAreaGeometryError('covered-area geometry has zero or negligible area');
  }
  if (row.route_valid === false) {
    throw new InvalidGeometryError('route is not a valid geometry');
  }
}

/** Covered area, pause point, and route must all lie within the territory's CURRENT revision. */
async function assertWithinCurrentRevision(
  client: PoolClient,
  territoryId: number,
  coveredArea: string,
  pausePoint: string | null,
  route: string | null
): Promise<void> {
  const { rows } = await client.query<{ covered_inside: boolean; pause_inside: boolean; route_inside: boolean }>(
    `SELECT ST_CoveredBy(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), tr.geom) AS covered_inside,
            ($3::text IS NULL OR ST_CoveredBy(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), tr.geom)) AS pause_inside,
            ($4::text IS NULL OR ST_CoveredBy(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326), tr.geom)) AS route_inside
     FROM (
       SELECT geom FROM territory_revisions
       WHERE territory_id = $1
       ORDER BY revision_number DESC
       LIMIT 1
     ) tr`,
    [territoryId, coveredArea, pausePoint, route]
  );
  const row = rows[0];
  if (!row) throw new ValidationError('the territory has no geometry revision to record progress against');
  if (!row.covered_inside) {
    throw new OutOfBoundsError("covered-area geometry must lie within the territory's current boundary");
  }
  if (!row.pause_inside) {
    throw new OutOfBoundsError("pause point must lie within the territory's current boundary");
  }
  if (!row.route_inside) {
    throw new OutOfBoundsError("route must lie within the territory's current boundary");
  }
}

interface ComputedRemaining {
  /** EWKB of the new remaining area (an explicit empty polygon when nothing is left). */
  readonly remaining: Buffer;
  readonly baseline: CoverageBaseline | null;
}

/**
 * previous remaining area of the current cycle MINUS covered area. The
 * previous remaining area is the latest non-null remaining_area recorded
 * since the current cycle started; when there is none, the administrator
 * must have explicitly confirmed the whole-territory baseline. The
 * difference is rejected — never repaired — when it is not a valid
 * polygonal geometry or is a negligible sliver.
 */
async function computeRemaining(
  client: PoolClient,
  territoryId: number,
  cycleNumber: number,
  coveredArea: string,
  baseline: CoverageBaseline | undefined
): Promise<ComputedRemaining> {
  const { rows: previousRows } = await client.query<{ id: string }>(
    `SELECT pe.id
     FROM progress_entries pe
     WHERE pe.territory_id = $1
       AND pe.remaining_area IS NOT NULL
       AND pe.recorded_at >= (
         SELECT min(created_at) FROM territory_operational_events
         WHERE territory_id = $1 AND cycle_number = $2
       )
     ORDER BY pe.recorded_at DESC, pe.id DESC
     LIMIT 1`,
    [territoryId, cycleNumber]
  );
  const previousEntryId = previousRows[0]?.id ?? null;

  if (previousEntryId !== null && baseline !== undefined) {
    throw new ValidationError('a baseline is only accepted for the first coverage session of a cycle; this cycle already has a remaining area');
  }
  if (previousEntryId === null && baseline === undefined) {
    throw new BaselineRequiredError();
  }

  const { rows } = await client.query<{
    overlap_area: number;
    diff_empty: boolean;
    diff_type: string;
    diff_valid: boolean;
    diff_area: number;
    diff: Buffer;
  }>(
    `WITH base AS (
       SELECT CASE
         WHEN $2::bigint IS NULL THEN (
           SELECT geom FROM territory_revisions WHERE territory_id = $1 ORDER BY revision_number DESC LIMIT 1
         )
         ELSE (SELECT remaining_area FROM progress_entries WHERE id = $2::bigint)
       END AS geom
     ), computed AS (
       SELECT ST_Area(ST_Intersection(base.geom, covered.geom)) AS overlap_area,
              ST_Difference(base.geom, covered.geom) AS diff
       FROM base, (SELECT ST_SetSRID(ST_GeomFromGeoJSON($3), 4326) AS geom) covered
     )
     SELECT overlap_area,
            ST_IsEmpty(diff) AS diff_empty,
            ST_GeometryType(diff) AS diff_type,
            ST_IsValid(diff) AS diff_valid,
            ST_Area(diff) AS diff_area,
            ST_AsEWKB(CASE WHEN ST_IsEmpty(diff) THEN ST_GeomFromText('POLYGON EMPTY', 4326) ELSE diff END) AS diff
     FROM computed`,
    [territoryId, previousEntryId, coveredArea]
  );
  const row = rows[0];
  if (!row) throw new Error('remaining-area computation returned no row');
  if (!(row.overlap_area > AREA_EPSILON)) {
    throw new CoveredAreaNotRemainingError(
      previousEntryId === null
        ? 'covered area does not overlap the territory'
        : 'covered area does not overlap the remaining area of the current cycle (it may already be fully covered)'
    );
  }
  if (!row.diff_empty) {
    if (!['ST_Polygon', 'ST_MultiPolygon'].includes(row.diff_type) || !row.diff_valid) {
      throw new InvalidGeometryError('subtracting the covered area leaves an invalid remaining area; redraw the covered area');
    }
    if (!(row.diff_area > AREA_EPSILON)) {
      throw new ZeroAreaGeometryError(
        'subtracting the covered area leaves only a negligible sliver; extend the covered area to the remaining edge'
      );
    }
  }
  return { remaining: row.diff, baseline: baseline ?? null };
}

export async function recordProgress(
  pool: TransactionalPool,
  territoryId: number,
  input: RecordProgressInput
): Promise<ProgressEntry> {
  const recordedBy = input.recordedBy.trim();
  if (recordedBy === '') {
    throw new ValidationError('recordedBy must not be blank');
  }
  if (input.remainingArea !== undefined) {
    throw new ValidationError('remainingArea is computed by the server; send coveredArea instead');
  }
  const coveredArea = validateCoveredArea(input.coveredArea);
  const baseline = validateOptionalBaseline(input.baseline);
  const pausePoint = validateOptionalPausePoint(input.pausePoint);
  const route = validateOptionalRoute(input.route);
  const note = input.note?.trim() || null;

  const coveredParam = JSON.stringify(coveredArea);
  const pauseParam = toGeoJsonParam(pausePoint);
  const routeParam = toGeoJsonParam(route);

  return withTransaction(pool, async (client) => {
    // This row lock serializes the open-territory check with concurrent
    // state changes (a cycle cannot close under a session being recorded)
    // and serializes concurrent sessions so each subtracts from the latest
    // remaining area rather than from a stale one.
    const { rows: territoryRows } = await client.query<{ id: string }>(
      `SELECT id FROM territories WHERE id = $1 FOR UPDATE`,
      [territoryId]
    );
    if (!territoryRows[0]) {
      throw new TerritoryNotFoundError(territoryId);
    }

    // 2026-10-03: recording requires an explicitly OPENED territory. There is
    // no implicit opening on the first session any more; paused (legacy)
    // still counts as open.
    const { rows: operationalRows } = await client.query<{ action: string; cycle_number: number }>(
      `SELECT action, cycle_number
       FROM territory_operational_events
       WHERE territory_id = $1
       ORDER BY id DESC
       LIMIT 1`,
      [territoryId]
    );
    const operational = operationalRows[0];
    if (!operational) {
      throw new TerritoryNotOpenError('the territory has not been opened; open it before recording progress');
    }
    if (!OPEN_ACTIONS.has(operational.action)) {
      throw new TerritoryNotOpenError('the territory is closed; open it again before recording progress');
    }
    const cycleNumber = operational.cycle_number;

    await assertSessionGeometriesValid(client, coveredParam, routeParam);
    await assertWithinCurrentRevision(client, territoryId, coveredParam, pauseParam, routeParam);

    const computed = await computeRemaining(client, territoryId, cycleNumber, coveredParam, baseline);

    try {
      const { rows } = await client.query<ProgressEntryRow>(
        `WITH inserted AS (
           INSERT INTO progress_entries
             (territory_id, recorded_by, note, pause_point, route, covered_area, baseline, remaining_area, recorded_at)
           VALUES (
             $1, $2, $3,
             ST_SetSRID(ST_GeomFromGeoJSON($4), 4326),
             ST_SetSRID(ST_GeomFromGeoJSON($5), 4326),
             ST_SetSRID(ST_GeomFromGeoJSON($6), 4326),
             $7,
             ST_GeomFromEWKB($8),
             -- Taken AFTER the territory lock, unlike now() (transaction
             -- start): a session that waited on the lock must still sort
             -- after the one it subtracted from, for every "latest remaining
             -- area" reader (admin status, public view, the next session).
             clock_timestamp()
           )
           RETURNING id, territory_id, recorded_by, recorded_at, note, pause_point, route,
                     covered_area, baseline, remaining_area
         )
         SELECT id, territory_id, $9::integer AS cycle_number, recorded_by, recorded_at, note,
                ST_AsGeoJSON(pause_point)::json AS pause_point,
                ST_AsGeoJSON(route)::json AS route,
                ST_AsGeoJSON(covered_area)::json AS covered_area,
                baseline,
                ST_AsGeoJSON(remaining_area)::json AS remaining_area
         FROM inserted`,
        [
          territoryId,
          recordedBy,
          note,
          pauseParam,
          routeParam,
          coveredParam,
          computed.baseline,
          computed.remaining,
          cycleNumber
        ]
      );
      const row = rows[0];
      if (!row) {
        throw new Error('progress_entries insert returned no row');
      }
      const entry = toProgressEntry(row);

      await recordAuditEvent(client, {
        entityType: 'territory',
        entityId: territoryId,
        action: 'progress_recorded',
        actor: recordedBy,
        reason: note ?? 'progress recorded',
        payload: {
          progressEntryId: entry.id,
          cycleNumber,
          hasCoveredArea: true,
          baseline: entry.baseline,
          hasPausePoint: entry.pausePoint !== null,
          hasRoute: entry.route !== null,
          remainingAreaStatus: entry.remainingAreaStatus,
          nothingRemaining: isEmptyGeometry(entry.remainingArea)
        }
      });

      return entry;
    } catch (error) {
      rethrowAsProgressEntryError(error);
    }
  });
}

/** An explicit empty polygon — the stored "nothing left" marker (db/migrations/0007). */
export function isEmptyGeometry(geometry: Polygon | MultiPolygon | null): boolean {
  return geometry !== null && geometry.coordinates.length === 0;
}

export async function listProgressEntries(
  pool: TransactionalPool,
  territoryId: number
): Promise<readonly ProgressEntry[]> {
  return withTransaction(pool, async (client) => {
    const { rows: territoryRows } = await client.query<{ id: string }>(
      `SELECT id FROM territories WHERE id = $1`,
      [territoryId]
    );
    if (!territoryRows[0]) {
      throw new TerritoryNotFoundError(territoryId);
    }

    const { rows } = await client.query<ProgressEntryRow>(
      `${PROGRESS_SELECT} WHERE pe.territory_id = $1 ORDER BY pe.recorded_at ASC, pe.id ASC`,
      [territoryId]
    );
    return rows.map(toProgressEntry);
  });
}
