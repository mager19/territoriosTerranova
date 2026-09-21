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
 */

import type { LineString, Point, Polygon } from '@territorios/geo';

import { recordAuditEvent } from './audit.js';
import { TerritoryNotFoundError, ValidationError } from './errors.js';
import {
  validateOptionalPausePoint,
  validateOptionalRemainingArea,
  validateOptionalRoute
} from './geometry.js';
import { rethrowAsProgressEntryError } from '../db/pg-error-mapper.js';
import { withTransaction, type TransactionalPool } from '../db/transaction.js';

export interface ProgressEntry {
  readonly id: number;
  readonly territoryId: number;
  readonly recordedBy: string;
  readonly recordedAt: string;
  readonly note: string | null;
  readonly pausePoint: Point | null;
  readonly route: LineString | null;
  readonly remainingArea: Polygon | null;
  /** Explicit, never-inferred marker: 'unknown' means the geometry was not recorded, not "fully covered". */
  readonly remainingAreaStatus: 'recorded' | 'unknown';
}

interface ProgressEntryRow {
  readonly id: string;
  readonly territory_id: string;
  readonly recorded_by: string;
  readonly recorded_at: string;
  readonly note: string | null;
  readonly pause_point: Point | null;
  readonly route: LineString | null;
  readonly remaining_area: Polygon | null;
}

function toProgressEntry(row: ProgressEntryRow): ProgressEntry {
  return {
    id: Number(row.id),
    territoryId: Number(row.territory_id),
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at,
    note: row.note,
    pausePoint: row.pause_point,
    route: row.route,
    remainingArea: row.remaining_area,
    remainingAreaStatus: row.remaining_area === null ? 'unknown' : 'recorded'
  };
}

const PROGRESS_SELECT = `
  SELECT id, territory_id, recorded_by, recorded_at, note,
         ST_AsGeoJSON(pause_point)::json AS pause_point,
         ST_AsGeoJSON(route)::json AS route,
         ST_AsGeoJSON(remaining_area)::json AS remaining_area
  FROM progress_entries
`;

export interface RecordProgressInput {
  readonly recordedBy: string;
  readonly note?: string;
  readonly pausePoint?: unknown;
  readonly route?: unknown;
  readonly remainingArea?: unknown;
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
  const pausePoint = validateOptionalPausePoint(input.pausePoint);
  const route = validateOptionalRoute(input.route);
  const remainingArea = validateOptionalRemainingArea(input.remainingArea);
  const note = input.note?.trim() || null;

  return withTransaction(pool, async (client) => {
    const { rows: territoryRows } = await client.query<{ id: string }>(
      `SELECT id FROM territories WHERE id = $1`,
      [territoryId]
    );
    if (!territoryRows[0]) {
      throw new TerritoryNotFoundError(territoryId);
    }

    try {
      const { rows } = await client.query<ProgressEntryRow>(
        `WITH inserted AS (
           INSERT INTO progress_entries (territory_id, recorded_by, note, pause_point, route, remaining_area)
           VALUES (
             $1, $2, $3,
             ST_SetSRID(ST_GeomFromGeoJSON($4), 4326),
             ST_SetSRID(ST_GeomFromGeoJSON($5), 4326),
             ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)
           )
           RETURNING id, territory_id, recorded_by, recorded_at, note, pause_point, route, remaining_area
         )
         SELECT id, territory_id, recorded_by, recorded_at, note,
                ST_AsGeoJSON(pause_point)::json AS pause_point,
                ST_AsGeoJSON(route)::json AS route,
                ST_AsGeoJSON(remaining_area)::json AS remaining_area
         FROM inserted`,
        [
          territoryId,
          recordedBy,
          note,
          pausePoint ? JSON.stringify(pausePoint) : null,
          route ? JSON.stringify(route) : null,
          remainingArea ? JSON.stringify(remainingArea) : null
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
          hasPausePoint: entry.pausePoint !== null,
          hasRoute: entry.route !== null,
          remainingAreaStatus: entry.remainingAreaStatus
        }
      });

      return entry;
    } catch (error) {
      rethrowAsProgressEntryError(error);
    }
  });
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
      `${PROGRESS_SELECT} WHERE territory_id = $1 ORDER BY recorded_at ASC`,
      [territoryId]
    );
    return rows.map(toProgressEntry);
  });
}
