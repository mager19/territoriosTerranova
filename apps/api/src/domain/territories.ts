/**
 * Territory and revision domain operations — slice 1 of the A3 brief.
 *
 * Every geometry change writes a NEW row in territory_revisions; nothing is
 * ever updated in place (A2's migration enforces this with a trigger; this
 * layer never attempts an UPDATE against that table, on purpose). Current
 * state (the active geometry) is always DERIVED as the highest
 * revision_number for a territory — there is no denormalized "current geom"
 * column that could drift from history.
 */

import type { Polygon } from '@territorios/geo';
import type { PoolClient } from 'pg';

import { getTerritoryAuditHistory as queryTerritoryAuditHistory, recordAuditEvent, type AuditEvent } from './audit.js';
import { TerritoryNotFoundError, ValidationError } from './errors.js';
import { validateTerritoryGeometry } from './geometry.js';
import { rethrowAsTerritoryGeometryError, rethrowAsTerritoryNumberError } from '../db/pg-error-mapper.js';
import { withTransaction, type TransactionalPool } from '../db/transaction.js';

export type TerritoryStatus = 'active' | 'archived';

export interface Territory {
  readonly id: number;
  readonly name: string;
  readonly number: string | null;
  readonly status: TerritoryStatus;
  readonly createdAt: string;
  readonly currentRevisionNumber: number;
}

/**
 * A territory as returned by the list endpoint — the base `Territory` plus
 * the CURRENT revision's geometry (the highest `revision_number`), so the
 * admin grid can render a static thumbnail without a per-card WebGL map.
 * `geometry` is `null` when the territory has no revisions yet.
 */
export interface TerritoryListItem extends Territory {
  readonly geometry: Polygon | null;
  readonly operationalState: 'no_record' | 'in_progress' | 'paused' | 'cycle_completed' | 'reopened';
}

export interface TerritoryRevision {
  readonly id: number;
  readonly territoryId: number;
  readonly revisionNumber: number;
  readonly geometry: Polygon;
  readonly author: string;
  readonly createdAt: string;
}

export interface TerritoryWithRevisions {
  readonly id: number;
  readonly name: string;
  readonly number: string | null;
  readonly status: TerritoryStatus;
  readonly createdAt: string;
  readonly revisions: readonly TerritoryRevision[];
}

interface TerritoryRow {
  readonly id: string;
  readonly name: string;
  readonly number: string | null;
  readonly status: TerritoryStatus;
  readonly created_at: string;
  readonly current_revision_number: string | null;
}

interface TerritoryListItemRow extends TerritoryRow {
  readonly geometry: Polygon | null;
  readonly operational_state: TerritoryListItem['operationalState'];
}

interface RevisionRow {
  readonly id: string;
  readonly territory_id: string;
  readonly revision_number: number;
  readonly geometry: Polygon;
  readonly author: string;
  readonly created_at: string;
}

function toTerritory(row: TerritoryRow): Territory {
  return {
    id: Number(row.id),
    name: row.name,
    number: row.number,
    status: row.status,
    createdAt: row.created_at,
    currentRevisionNumber: row.current_revision_number === null ? 0 : Number(row.current_revision_number)
  };
}

function toTerritoryListItem(row: TerritoryListItemRow): TerritoryListItem {
  return { ...toTerritory(row), geometry: row.geometry, operationalState: row.operational_state };
}

function toRevision(row: RevisionRow): TerritoryRevision {
  return {
    id: Number(row.id),
    territoryId: Number(row.territory_id),
    revisionNumber: row.revision_number,
    geometry: row.geometry,
    author: row.author,
    createdAt: row.created_at
  };
}

async function insertRevision(
  client: PoolClient,
  territoryId: number,
  revisionNumber: number,
  geometry: Polygon,
  author: string
): Promise<RevisionRow> {
  try {
    const { rows } = await client.query<RevisionRow>(
      `INSERT INTO territory_revisions (territory_id, revision_number, geom, author)
       VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4)
       RETURNING id, territory_id, revision_number,
                 ST_AsGeoJSON(geom)::json AS geometry, author, created_at`,
      [territoryId, revisionNumber, JSON.stringify(geometry), author]
    );
    const row = rows[0];
    if (!row) {
      throw new Error('territory_revisions insert returned no row');
    }
    return row;
  } catch (error) {
    rethrowAsTerritoryGeometryError(error);
  }
}

export interface CreateTerritoryInput {
  readonly name: string;
  readonly geometry: unknown;
  readonly author: string;
  readonly number?: string;
}

export async function createTerritory(
  pool: TransactionalPool,
  input: CreateTerritoryInput
): Promise<TerritoryWithRevisions> {
  const geometry = validateTerritoryGeometry(input.geometry);
  const name = input.name.trim();
  const author = input.author.trim();
  if (name === '') {
    throw new ValidationError('name must not be blank');
  }
  if (author === '') {
    throw new ValidationError('author must not be blank');
  }

  return withTransaction(pool, async (client) => {
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
    const territoryRow = rows[0];
    if (!territoryRow) {
      throw new Error('territories insert returned no row');
    }
    const territoryId = Number(territoryRow.id);

    const revision = await insertRevision(client, territoryId, 1, geometry, author);

    await recordAuditEvent(client, {
      entityType: 'territory',
      entityId: territoryId,
      action: 'created',
      actor: author,
      reason: 'territory created',
      payload: { revisionId: Number(revision.id), revisionNumber: revision.revision_number }
    });

    return {
      id: territoryId,
      name,
      number: trimmedNumber === undefined || trimmedNumber === '' ? null : trimmedNumber,
      status: territoryRow.status,
      createdAt: territoryRow.created_at,
      revisions: [toRevision(revision)]
    };
  });
}

export async function listTerritories(pool: TransactionalPool): Promise<readonly TerritoryListItem[]> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<TerritoryListItemRow>(
      `SELECT t.id, t.name, t.number, t.status, t.created_at,
              (SELECT max(r.revision_number) FROM territory_revisions r WHERE r.territory_id = t.id)
                AS current_revision_number,
               latest.geometry,
               COALESCE(operation.action::text, 'no_record') AS operational_state
       FROM territories t
       LEFT JOIN LATERAL (
         SELECT ST_AsGeoJSON(r.geom)::json AS geometry
         FROM territory_revisions r
         WHERE r.territory_id = t.id
         ORDER BY r.revision_number DESC
         LIMIT 1
       ) latest ON TRUE
       LEFT JOIN LATERAL (
         SELECT action
         FROM territory_operational_events
         WHERE territory_id = t.id
         ORDER BY id DESC
         LIMIT 1
       ) operation ON TRUE
       ORDER BY t.id`
    );
    return rows.map(toTerritoryListItem);
  });
}

export async function getTerritoryWithRevisions(
  pool: TransactionalPool,
  territoryId: number
): Promise<TerritoryWithRevisions> {
  return withTransaction(pool, async (client) => {
    const { rows: territoryRows } = await client.query<{
      id: string;
      name: string;
      number: string | null;
      status: TerritoryStatus;
      created_at: string;
    }>(`SELECT id, name, number, status, created_at FROM territories WHERE id = $1`, [territoryId]);
    const territoryRow = territoryRows[0];
    if (!territoryRow) {
      throw new TerritoryNotFoundError(territoryId);
    }

    const { rows: revisionRows } = await client.query<RevisionRow>(
      `SELECT id, territory_id, revision_number, ST_AsGeoJSON(geom)::json AS geometry, author, created_at
       FROM territory_revisions
       WHERE territory_id = $1
       ORDER BY revision_number ASC`,
      [territoryId]
    );

    return {
      id: Number(territoryRow.id),
      name: territoryRow.name,
      number: territoryRow.number,
      status: territoryRow.status,
      createdAt: territoryRow.created_at,
      revisions: revisionRows.map(toRevision)
    };
  });
}

export interface SubmitRevisionInput {
  readonly geometry: unknown;
  readonly author: string;
}

export async function submitRevision(
  pool: TransactionalPool,
  territoryId: number,
  input: SubmitRevisionInput
): Promise<TerritoryRevision> {
  const geometry = validateTerritoryGeometry(input.geometry);
  const author = input.author.trim();
  if (author === '') {
    throw new ValidationError('author must not be blank');
  }

  return withTransaction(pool, async (client) => {
    // Row lock serializes concurrent revision submissions for the SAME
    // territory so two submitters never compute the same "next" revision
    // number — the DB's UNIQUE(territory_id, revision_number) constraint
    // would otherwise turn a race into a confusing, unmapped 23505 for a
    // perfectly valid geometry.
    const { rows: lockRows } = await client.query<{ id: string }>(
      `SELECT id FROM territories WHERE id = $1 FOR UPDATE`,
      [territoryId]
    );
    if (!lockRows[0]) {
      throw new TerritoryNotFoundError(territoryId);
    }

    const { rows: maxRows } = await client.query<{ next: number }>(
      `SELECT COALESCE(max(revision_number), 0) + 1 AS next FROM territory_revisions WHERE territory_id = $1`,
      [territoryId]
    );
    const nextRevisionNumber = maxRows[0]?.next ?? 1;

    const revision = await insertRevision(client, territoryId, nextRevisionNumber, geometry, author);

    await recordAuditEvent(client, {
      entityType: 'territory',
      entityId: territoryId,
      action: 'revision_submitted',
      actor: author,
      reason: 'new geometry revision submitted',
      payload: { revisionId: Number(revision.id), revisionNumber: revision.revision_number }
    });

    return toRevision(revision);
  });
}

/**
 * Full audit history for a territory (slice 3): its own events plus every
 * event recorded against its assignments. 404s via TerritoryNotFoundError
 * first — audit.ts's query alone can't distinguish "no history" from "no
 * such territory", since an empty result is valid for a brand-new territory
 * (well, not quite: creation itself always writes an event — but a
 * nonexistent territory must still 404, not silently return []).
 */
export async function getTerritoryAuditHistory(
  pool: TransactionalPool,
  territoryId: number
): Promise<readonly AuditEvent[]> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM territories WHERE id = $1`, [territoryId]);
    if (!rows[0]) {
      throw new TerritoryNotFoundError(territoryId);
    }
    return queryTerritoryAuditHistory(client, territoryId);
  });
}

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
