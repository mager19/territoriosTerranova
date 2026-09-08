/**
 * Share-token persistence and the public read query (A4 brief).
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

import type { Polygon } from '@territorios/geo';

import { generateShareToken, hashShareToken } from './token-crypto.js';
import { withTransaction, type TransactionalPool } from '../db/transaction.js';
import { AssignmentNotFoundError } from '../domain/errors.js';

export interface CreatedShareToken {
  readonly id: number;
  /** Shown here exactly once. Never returned, logged, or stored again after this call. */
  readonly token: string;
  readonly assignmentId: number;
  readonly createdAt: string;
  readonly expiresAt: string | null;
}

export interface CreateShareTokenInput {
  readonly assignmentId: number;
  readonly expiresAt?: Date;
}

export async function createShareToken(
  pool: TransactionalPool,
  input: CreateShareTokenInput
): Promise<CreatedShareToken> {
  const token = generateShareToken();
  const tokenHash = hashShareToken(token);

  return withTransaction(pool, async (client) => {
    const { rows: assignmentRows } = await client.query<{ id: string }>(
      `SELECT id FROM assignments WHERE id = $1`,
      [input.assignmentId]
    );
    if (!assignmentRows[0]) {
      throw new AssignmentNotFoundError(input.assignmentId);
    }

    const { rows } = await client.query<{
      id: string;
      assignment_id: string;
      created_at: string;
      expires_at: string | null;
    }>(
      `INSERT INTO share_tokens (assignment_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id, assignment_id, created_at, expires_at`,
      [input.assignmentId, tokenHash, input.expiresAt ?? null]
    );
    const row = rows[0];
    if (!row) {
      throw new Error('share_tokens insert returned no row');
    }

    return {
      id: Number(row.id),
      token,
      assignmentId: Number(row.assignment_id),
      createdAt: row.created_at,
      expiresAt: row.expires_at
    };
  });
}

/** Idempotent: revoking an already-revoked or nonexistent token is a silent no-op — an admin acting on their own token is never told which, since that distinction is not sensitive to them but the endpoint's shape should not need to differ. */
export async function revokeShareToken(pool: TransactionalPool, tokenId: number): Promise<void> {
  return withTransaction(pool, async (client) => {
    await client.query(
      `UPDATE share_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
      [tokenId]
    );
  });
}

export interface PublicTerritoryView {
  readonly territoryName: string;
  readonly boundary: Polygon;
  readonly remainingArea: Polygon | null;
  readonly remainingAreaStatus: 'recorded' | 'unknown';
}

interface PublicViewRow {
  readonly revoked_at: string | null;
  readonly expires_at: string | null;
  readonly territory_name: string;
  readonly boundary: Polygon;
  readonly remaining_area: Polygon | null;
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
         ST_AsGeoJSON(pe.remaining_area)::json AS remaining_area
       FROM share_tokens st
       JOIN assignments a ON a.id = st.assignment_id
       JOIN territories t ON t.id = a.territory_id
       JOIN territory_revisions tr ON tr.id = a.territory_revision_id
       LEFT JOIN LATERAL (
         SELECT remaining_area
         FROM progress_entries
         WHERE assignment_id = a.id
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
      remainingAreaStatus: row.remaining_area === null ? 'unknown' : 'recorded'
    };
  });
}
