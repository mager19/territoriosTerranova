/** Immutable, administrator-controlled operational work cycles. */

import type { MultiPolygon, Polygon } from '@territorios/geo';
import type { PoolClient } from 'pg';

import { recordAuditEvent } from './audit.js';
import { TerritoryNotFoundError, ValidationError } from './errors.js';
import { withTransaction, type TransactionalPool } from '../db/transaction.js';

export type OperationalState = 'no_record' | 'in_progress' | 'paused' | 'cycle_completed' | 'reopened';
export type OperationalAction = Exclude<OperationalState, 'no_record'>;

export interface TerritoryOperationalStatus {
  readonly state: OperationalState;
  readonly cycleNumber: number | null;
  readonly effectiveCompletionDate: string | null;
  /** Latest remaining area of the current cycle; an empty polygon means nothing is left, null means unknown. */
  readonly remainingArea: Polygon | MultiPolygon | null;
  readonly remainingAreaStatus: 'recorded' | 'unknown';
  /**
   * Approximate progress of the current cycle, 0–100:
   * 100 × (1 − geodesic area(remaining) / geodesic area(current revision)),
   * clamped to [0, 100]. null (unknown) when the cycle has no remaining
   * area — never inferred from the territory polygon.
   */
  readonly progressPercent: number | null;
}

interface EventRow {
  readonly id: string;
  readonly cycle_number: number;
  readonly action: OperationalAction;
  readonly effective_completion_date: string | null;
}

async function lockTerritory(client: PoolClient, territoryId: number): Promise<void> {
  const { rows } = await client.query<{ id: string }>('SELECT id FROM territories WHERE id = $1 FOR UPDATE', [territoryId]);
  if (!rows[0]) throw new TerritoryNotFoundError(territoryId);
}

async function latestEvent(client: PoolClient, territoryId: number): Promise<EventRow | null> {
  const { rows } = await client.query<EventRow>(
    `SELECT id, cycle_number, action, effective_completion_date
     FROM territory_operational_events
     WHERE territory_id = $1
     ORDER BY id DESC
     LIMIT 1`,
    [territoryId]
  );
  return rows[0] ?? null;
}

function assertTransition(current: OperationalState, action: OperationalAction): void {
  const allowed: Readonly<Record<OperationalState, readonly OperationalAction[]>> = {
    no_record: ['in_progress'],
    in_progress: ['paused', 'cycle_completed'],
    paused: ['in_progress', 'cycle_completed'],
    cycle_completed: ['reopened'],
    reopened: ['paused', 'cycle_completed']
  };
  if (!allowed[current].includes(action)) {
    throw new ValidationError(`cannot change operational state from ${current} to ${action}`);
  }
}

function stateFromAction(action: OperationalAction | null): OperationalState {
  return action ?? 'no_record';
}

async function queryTerritoryOperationalStatus(
  client: PoolClient,
  territoryId: number
): Promise<TerritoryOperationalStatus> {
  const { rows } = await client.query<{
      id: string;
      action: OperationalAction | null;
      cycle_number: number | null;
      effective_completion_date: Date | string | null;
      remaining_area: Polygon | MultiPolygon | null;
      progress_percent: number | null;
    }>(
      `SELECT t.id, latest.action, latest.cycle_number, latest.effective_completion_date,
              ST_AsGeoJSON(coverage.remaining_area)::json AS remaining_area,
              CASE
                WHEN coverage.remaining_area IS NULL OR current_revision.geom IS NULL THEN NULL
                ELSE 100 * GREATEST(0, LEAST(1,
                  1 - ST_Area(coverage.remaining_area::geography)
                      / NULLIF(ST_Area(current_revision.geom::geography), 0)
                ))
              END AS progress_percent
       FROM territories t
       LEFT JOIN LATERAL (
         SELECT geom
         FROM territory_revisions
         WHERE territory_id = t.id
         ORDER BY revision_number DESC
         LIMIT 1
       ) current_revision ON TRUE
       LEFT JOIN LATERAL (
         SELECT id, action, cycle_number, effective_completion_date, created_at
         FROM territory_operational_events
         WHERE territory_id = t.id
         ORDER BY id DESC
         LIMIT 1
       ) latest ON TRUE
       LEFT JOIN LATERAL (
         SELECT min(created_at) AS started_at
         FROM territory_operational_events
         WHERE territory_id = t.id AND cycle_number = latest.cycle_number
       ) cycle_start ON TRUE
       LEFT JOIN LATERAL (
         SELECT remaining_area
         FROM progress_entries
         WHERE territory_id = t.id
           AND remaining_area IS NOT NULL
           AND recorded_at >= cycle_start.started_at
         ORDER BY recorded_at DESC, id DESC
         LIMIT 1
       ) coverage ON TRUE
       WHERE t.id = $1`,
      [territoryId]
  );
  const row = rows[0];
  if (!row) throw new TerritoryNotFoundError(territoryId);
  return {
    state: stateFromAction(row.action),
    cycleNumber: row.cycle_number,
    effectiveCompletionDate: row.effective_completion_date === null
      ? null
      : typeof row.effective_completion_date === 'string'
        ? row.effective_completion_date
        : row.effective_completion_date.toISOString().slice(0, 10),
    remainingArea: row.remaining_area,
    remainingAreaStatus: row.remaining_area === null ? 'unknown' : 'recorded',
    progressPercent: row.progress_percent === null ? null : Number(row.progress_percent)
  };
}

export async function getTerritoryOperationalStatus(
  pool: TransactionalPool,
  territoryId: number
): Promise<TerritoryOperationalStatus> {
  return withTransaction(pool, (client) => queryTerritoryOperationalStatus(client, territoryId));
}

export interface ChangeOperationalStateInput {
  readonly action: OperationalAction;
  readonly actor: string;
  /** Optional for every action (2026-10-03: reopening no longer requires one); stored as NULL when absent. */
  readonly reason?: string;
  readonly effectiveCompletionDate?: string;
}

export async function changeTerritoryOperationalState(
  pool: TransactionalPool,
  territoryId: number,
  input: ChangeOperationalStateInput
): Promise<TerritoryOperationalStatus> {
  const actor = input.actor.trim();
  const reason = input.reason?.trim() || null;
  if (actor === '') throw new ValidationError('actor must not be blank');
  if (input.action === 'cycle_completed' && !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveCompletionDate ?? '')) {
    throw new ValidationError('cycle completion requires an effectiveCompletionDate in YYYY-MM-DD format');
  }

  return withTransaction(pool, async (client) => {
    await lockTerritory(client, territoryId);
    const latest = await latestEvent(client, territoryId);
    const current = stateFromAction(latest?.action ?? null);
    assertTransition(current, input.action);
    const cycleNumber = input.action === 'reopened' ? (latest?.cycle_number ?? 0) + 1 : (latest?.cycle_number ?? 1);

    await client.query(
      `INSERT INTO territory_operational_events
        (territory_id, cycle_number, action, actor, reason, effective_completion_date)
       VALUES ($1, $2, $3, $4, $5, $6::date)`,
      [territoryId, cycleNumber, input.action, actor, reason, input.effectiveCompletionDate ?? null]
    );
    await recordAuditEvent(client, {
      entityType: 'territory',
      entityId: territoryId,
      action: `operational_${input.action}`,
      actor,
      reason: reason ?? `operational state changed to ${input.action}`,
      payload: { cycleNumber, effectiveCompletionDate: input.effectiveCompletionDate ?? null }
    });

    return queryTerritoryOperationalStatus(client, territoryId);
  });
}

/**
 * One operational work cycle, derived from the append-only events: opened by
 * its first event, closed by its cycle_completed event (null while open).
 */
export interface TerritoryCycle {
  readonly cycleNumber: number;
  /** ISO timestamp of the first operational event of the cycle. */
  readonly openedAt: string;
  /** ISO timestamp of the cycle_completed event, or null while the cycle is open. */
  readonly closedAt: string | null;
  /** The administrator-declared completion date (YYYY-MM-DD), or null while the cycle is open. */
  readonly effectiveCompletionDate: string | null;
  /**
   * Progress entries attributed to this cycle — same attribution as the
   * progress list: the latest operational event recorded no later than the
   * entry. Entries recorded before the first cycle belong to none.
   */
  readonly sessionCount: number;
}

/** Every cycle of a territory, newest first. Read-only; derived from existing tables. */
export async function listTerritoryCycles(
  pool: TransactionalPool,
  territoryId: number
): Promise<readonly TerritoryCycle[]> {
  return withTransaction(pool, async (client) => {
    const { rows: territoryRows } = await client.query<{ id: string }>('SELECT id FROM territories WHERE id = $1', [territoryId]);
    if (!territoryRows[0]) throw new TerritoryNotFoundError(territoryId);

    const { rows } = await client.query<{
      cycle_number: number;
      opened_at: Date;
      closed_at: Date | null;
      effective_completion_date: string | null;
      session_count: string;
    }>(
      `WITH cycles AS (
         SELECT cycle_number,
                min(created_at) AS opened_at,
                max(created_at) FILTER (WHERE action = 'cycle_completed') AS closed_at,
                to_char(max(effective_completion_date) FILTER (WHERE action = 'cycle_completed'), 'YYYY-MM-DD')
                  AS effective_completion_date
         FROM territory_operational_events
         WHERE territory_id = $1
         GROUP BY cycle_number
       ), sessions AS (
         SELECT attributed.cycle_number, count(*) AS session_count
         FROM progress_entries pe
         JOIN LATERAL (
           SELECT cycle_number
           FROM territory_operational_events
           WHERE territory_id = pe.territory_id AND created_at <= pe.recorded_at
           ORDER BY id DESC
           LIMIT 1
         ) attributed ON TRUE
         WHERE pe.territory_id = $1
         GROUP BY attributed.cycle_number
       )
       SELECT c.cycle_number, c.opened_at, c.closed_at, c.effective_completion_date,
              COALESCE(s.session_count, 0) AS session_count
       FROM cycles c
       LEFT JOIN sessions s ON s.cycle_number = c.cycle_number
       ORDER BY c.cycle_number DESC`,
      [territoryId]
    );
    return rows.map((row) => ({
      cycleNumber: row.cycle_number,
      openedAt: row.opened_at.toISOString(),
      closedAt: row.closed_at === null ? null : row.closed_at.toISOString(),
      effectiveCompletionDate: row.effective_completion_date,
      sessionCount: Number(row.session_count)
    }));
  });
}
