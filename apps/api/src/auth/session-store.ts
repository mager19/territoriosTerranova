/**
 * Administrator sessions (db/migrations/0009_admin_sessions.sql). The
 * browser holds a 32-byte random token; the database stores only its
 * SHA-256 hex digest, so a database read never yields a usable credential.
 * A session is valid while it is neither revoked nor expired.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { TransactionalPool } from '../db/transaction.js';

export const ADMIN_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_TOKEN_BYTES = 32;

export interface AdminSession {
  readonly id: number;
  readonly email: string;
  readonly expiresAt: Date;
}

export interface CreatedAdminSession {
  /** Plaintext token: goes into the cookie and nowhere else. */
  readonly token: string;
  readonly session: AdminSession;
}

/**
 * Injected into buildApp so route-level unit tests can exercise the guard
 * without a database; production wiring uses createPgAdminSessionStore.
 */
export interface AdminSessionStore {
  create(email: string): Promise<CreatedAdminSession>;
  /** Null for an unknown, revoked, or expired token alike. */
  resolve(token: string): Promise<AdminSession | null>;
  /** Idempotent; an unknown or already-revoked token is a no-op. */
  revoke(token: string): Promise<void>;
}

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

interface SessionRow {
  readonly id: string;
  readonly email: string;
  readonly expires_at: Date;
}

function toSession(row: SessionRow): AdminSession {
  return { id: Number(row.id), email: row.email, expiresAt: new Date(row.expires_at) };
}

export function createPgAdminSessionStore(
  pool: TransactionalPool,
  options: { readonly ttlSeconds?: number } = {}
): AdminSessionStore {
  const ttlSeconds = options.ttlSeconds ?? ADMIN_SESSION_TTL_SECONDS;

  async function query<T extends object>(text: string, values: readonly unknown[]): Promise<T[]> {
    const client = await pool.connect();
    try {
      const result = await client.query<T>(text, values as unknown[]);
      return result.rows;
    } finally {
      client.release();
    }
  }

  return {
    async create(email) {
      const token = generateSessionToken();
      const rows = await query<SessionRow>(
        `INSERT INTO admin_sessions (token_hash, email, expires_at)
         VALUES ($1, $2, now() + make_interval(secs => $3))
         RETURNING id, email, expires_at`,
        [hashSessionToken(token), email.trim().toLowerCase(), ttlSeconds]
      );
      const row = rows[0];
      if (!row) throw new Error('admin session insert returned no row');
      return { token, session: toSession(row) };
    },

    async resolve(token) {
      if (token === '') return null;
      const rows = await query<SessionRow>(
        `SELECT id, email, expires_at FROM admin_sessions
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
        [hashSessionToken(token)]
      );
      const row = rows[0];
      return row ? toSession(row) : null;
    },

    async revoke(token) {
      if (token === '') return;
      await query(
        `UPDATE admin_sessions SET revoked_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hashSessionToken(token)]
      );
    }
  };
}
