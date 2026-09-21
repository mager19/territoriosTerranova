/**
 * Share-token persistence and the public read query (A4 brief).
 *
 * A token scopes to a whole TERRITORY, not a per-person claim — 2026-09-08:
 * territories are shared to a group of volunteers, not assigned to one
 * named person (db/migrations/0004_remove_individual_assignment.sql).
 * `resolvePublicTerritoryView` therefore always resolves against the
 * territory's CURRENT (latest) revision and its latest progress entry —
 * there is no per-claim revision to pin against, so "current" is simply
 * "whatever the territory looks like right now".
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

import type { LineString, Polygon } from '@territorios/geo';

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
  readonly remainingArea: Polygon | null;
  readonly remainingAreaStatus: 'recorded' | 'unknown';
  /**
   * The latest progress entry's route line — deliberately exposed
   * (2026-09-08 product decision, AGENTS.md "Privacy rules"): a volunteer
   * needs to see the coverage line to know where to resume. Every other
   * progress-entry field (note, pause point, recordedBy, recordedAt) stays
   * excluded.
   */
  readonly route: LineString | null;
}

interface PublicViewRow {
  readonly revoked_at: string | null;
  readonly expires_at: string | null;
  readonly territory_name: string;
  readonly boundary: Polygon;
  readonly remaining_area: Polygon | null;
  readonly route: LineString | null;
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
         ST_AsGeoJSON(pe.remaining_area)::json AS remaining_area,
         ST_AsGeoJSON(pe.route)::json AS route
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
         SELECT remaining_area, route
         FROM progress_entries
         WHERE territory_id = t.id
         ORDER BY recorded_at DESC
         LIMIT 1
       ) pe ON TRUE
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
      route: row.route
    };
  });
}
