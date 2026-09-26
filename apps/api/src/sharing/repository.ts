/**
 * Share-token persistence and the public read query (A4 brief).
 *
 * A token scopes to a whole TERRITORY, not a per-person claim — 2026-09-08:
 * territories are shared to a group of volunteers, not assigned to one
 * named person (db/migrations/0004_remove_individual_assignment.sql).
 * `resolvePublicTerritoryView` therefore always resolves against the
 * territory's CURRENT (latest) revision and its CURRENT cycle's progress
 * entries — there is no per-claim revision to pin against, so "current" is
 * simply "whatever the territory looks like right now".
 *
 * `resolvePublicTerritoryView` is written so a revoked, expired, wrong-
 * scope, and genuinely valid token all execute the SAME query and the
 * SAME joins — validity is decided in application code only AFTER all of
 * that work is done, never by branching into more or less DB work per
 * outcome. That is the actual root cause of a timing side channel in a
 * typical "check existence, then check validity" implementation; this
 * structurally cannot have that shape. A token whose hash was never
 * generated (which is the overwhelming majority of attacker guesses,
 * given a 256-bit space) naturally returns zero rows — this remains true
 * for every not-found reason, so it does not itself introduce a
 * distinguishing signal.
 */

import type { LineString, MultiPolygon, Point, Polygon } from '@territorios/geo';

import { generateShareToken, hashShareToken } from './token-crypto.js';
import { recordAuditEvent } from '../domain/audit.js';
import { TerritoryNotFoundError } from '../domain/errors.js';
import { withTransaction, type TransactionalPool } from '../db/transaction.js';

export interface CreatedShareToken {
  readonly id: number;
  /** Shown here exactly once. Never returned, logged, or stored again after this call. */
  readonly token: string;
  readonly territoryId: number;
  readonly createdAt: string;
  readonly expiresAt: string | null;
}

export interface CreateShareTokenInput {
  readonly territoryId: number;
  readonly createdBy: string;
  readonly expiresAt?: Date;
}

export async function createShareToken(
  pool: TransactionalPool,
  input: CreateShareTokenInput
): Promise<CreatedShareToken> {
  const token = generateShareToken();
  const tokenHash = hashShareToken(token);

  return withTransaction(pool, async (client) => {
    const { rows: territoryRows } = await client.query<{ id: string }>(
      `SELECT id FROM territories WHERE id = $1`,
      [input.territoryId]
    );
    if (!territoryRows[0]) {
      throw new TerritoryNotFoundError(input.territoryId);
    }

    const { rows } = await client.query<{
      id: string;
      territory_id: string;
      created_at: string;
      expires_at: string | null;
    }>(
      `INSERT INTO share_tokens (territory_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id, territory_id, created_at, expires_at`,
      [input.territoryId, tokenHash, input.expiresAt ?? null]
    );
    const row = rows[0];
    if (!row) {
      throw new Error('share_tokens insert returned no row');
    }

    await recordAuditEvent(client, {
      entityType: 'territory',
      entityId: input.territoryId,
      action: 'shared',
      actor: input.createdBy,
      reason: 'territory shared to the volunteer group',
      payload: { shareTokenId: Number(row.id) }
    });

    return {
      id: Number(row.id),
      token,
      territoryId: Number(row.territory_id),
      createdAt: row.created_at,
      expiresAt: row.expires_at
    };
  });
}

/**
 * Idempotent: revoking an already-revoked or nonexistent token is a silent
 * no-op — an admin acting on their own token is never told which, since
 * that distinction is not sensitive to them but the endpoint's shape
 * should not need to differ. Only writes an audit event when a real
 * revocation happened (never for a no-op on an already-revoked/nonexistent
 * token — nothing changed, so there is nothing to attribute an actor to).
 */
export async function revokeShareToken(pool: TransactionalPool, tokenId: number, actor: string): Promise<void> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ territory_id: string }>(
      `UPDATE share_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL
       RETURNING territory_id`,
      [tokenId]
    );
    const row = rows[0];
    if (!row) {
      return;
    }
    await recordAuditEvent(client, {
      entityType: 'territory',
      entityId: Number(row.territory_id),
      action: 'share_revoked',
      actor,
      reason: 'share link revoked',
      payload: { shareTokenId: tokenId }
    });
  });
}

export interface PublicTerritoryView {
  readonly territoryName: string;
  readonly boundary: Polygon;
  /** Polygon or MultiPolygon since coverage sessions (0007); an empty polygon means nothing is left, null means unknown. */
  readonly remainingArea: Polygon | MultiPolygon | null;
  readonly remainingAreaStatus: 'recorded' | 'unknown';
  /**
   * The current cycle's latest RECORDED route line — deliberately exposed
   * (2026-09-08 product decision, AGENTS.md "Privacy rules"): a volunteer
   * needs to see the coverage line to know where to resume.
   */
  readonly route: LineString | null;
  /**
   * The current cycle's latest recorded pause point — "where the work
   * stopped". Deliberately exposed (2026-09-26 product decision, AGENTS.md
   * "Privacy rules"). Null when no entry of the current cycle recorded one.
   */
  readonly pausePoint: Point | null;
  /**
   * The UNION of every coverage session's covered area in the current
   * cycle, merged into ONE shape (2026-09-26 product decision). Per-session
   * geometries, session count, and timestamps are never exposed, so the
   * history cannot be reconstructed from it. Null when nothing was covered.
   * Every other progress-entry field (note, recordedBy, recordedAt,
   * baseline, cycle number) stays excluded.
   */
  readonly coveredArea: Polygon | MultiPolygon | null;
}

interface PublicViewRow {
  readonly revoked_at: string | null;
  readonly expires_at: string | null;
  readonly territory_name: string;
  readonly boundary: Polygon;
  readonly remaining_area: Polygon | MultiPolygon | null;
  readonly route: LineString | null;
  readonly pause_point: Point | null;
  readonly covered_area: Polygon | MultiPolygon | null;
}

/**
 * Resolves a plaintext token to the public, allowlisted view — or `null`
 * for every unauthorized reason alike (nonexistent, revoked, expired).
 * Callers MUST turn `null` into an identical 404 regardless of cause
 * (A4 brief hard constraint).
 */
export async function resolvePublicTerritoryView(
  pool: TransactionalPool,
  plaintextToken: string
): Promise<PublicTerritoryView | null> {
  const tokenHash = hashShareToken(plaintextToken);

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<PublicViewRow>(
      `SELECT
         st.revoked_at,
         st.expires_at,
         t.name AS territory_name,
         ST_AsGeoJSON(tr.geom)::json AS boundary,
         ST_AsGeoJSON(coverage.remaining_area)::json AS remaining_area,
         ST_AsGeoJSON(pe.route)::json AS route,
         ST_AsGeoJSON(pause.pause_point)::json AS pause_point,
         ST_AsGeoJSON(covered.covered_area)::json AS covered_area
       FROM share_tokens st
       JOIN territories t ON t.id = st.territory_id
       JOIN LATERAL (
         SELECT geom
         FROM territory_revisions
         WHERE territory_id = t.id
         ORDER BY revision_number DESC
         LIMIT 1
       ) tr ON TRUE
        LEFT JOIN LATERAL (
          SELECT min(created_at) AS started_at
          FROM territory_operational_events
          WHERE territory_id = t.id
            AND cycle_number = (
              SELECT cycle_number FROM territory_operational_events
              WHERE territory_id = t.id ORDER BY id DESC LIMIT 1
            )
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
        LEFT JOIN LATERAL (
          SELECT route
          FROM progress_entries
          WHERE territory_id = t.id
            AND route IS NOT NULL
            AND recorded_at >= cycle_start.started_at
          ORDER BY recorded_at DESC, id DESC
          LIMIT 1
        ) pe ON TRUE
        LEFT JOIN LATERAL (
          SELECT pause_point
          FROM progress_entries
          WHERE territory_id = t.id
            AND pause_point IS NOT NULL
            AND recorded_at >= cycle_start.started_at
          ORDER BY recorded_at DESC, id DESC
          LIMIT 1
        ) pause ON TRUE
        LEFT JOIN LATERAL (
          -- One merged shape, never per-session rows (2026-09-26 decision).
          -- ST_CollectionExtract(..., 3) keeps the result Polygon/MultiPolygon.
          SELECT ST_CollectionExtract(ST_Union(covered_area), 3) AS covered_area
          FROM progress_entries
          WHERE territory_id = t.id
            AND covered_area IS NOT NULL
            AND recorded_at >= cycle_start.started_at
        ) covered ON TRUE
       WHERE st.token_hash = $1`,
      [tokenHash]
    );

    const row = rows[0];
    if (!row) {
      return null;
    }
    if (row.revoked_at !== null) {
      return null;
    }
    if (row.expires_at !== null && new Date(row.expires_at).getTime() <= Date.now()) {
      return null;
    }

    return {
      territoryName: row.territory_name,
      boundary: row.boundary,
      remainingArea: row.remaining_area,
      remainingAreaStatus: row.remaining_area === null ? 'unknown' : 'recorded',
      route: row.route,
      pausePoint: row.pause_point,
      coveredArea: row.covered_area
    };
  });
}
