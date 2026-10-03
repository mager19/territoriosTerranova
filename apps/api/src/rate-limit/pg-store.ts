/**
 * A PostgreSQL-backed store for @fastify/rate-limit, so every API instance
 * shares one counter per limit key (db/migrations/0010_rate_limits.sql).
 * On Vercel each function instance has its own memory; the plugin's default
 * in-memory store would multiply every limit by the number of instances.
 *
 * Same semantics as the plugin's LocalStore: a fixed window that starts at
 * the first hit and resets once it has elapsed. The plugin turns
 * `{ current, ttl }` into the 429 response and the x-ratelimit-* headers
 * exactly as it does for the in-memory store, so responses are unchanged.
 *
 * The plugin hands every limiter (`app.rateLimit({...})`) a child store but
 * gives it no stable name, so this store keeps no per-limiter state: each
 * limiter's keyGenerator must put its own bucket name into the key
 * (app.ts). Keys are stored as SHA-256 hashes because they contain client
 * IPs and plaintext share tokens.
 */

import { createHash } from 'node:crypto';

import type { FastifyRateLimitStore, FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import type { Pool } from 'pg';

export type RateLimitPool = Pick<Pool, 'query'>;

/** How often one instance deletes expired rows, at most. */
export const DEFAULT_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

// One statement, so the read-modify-write is atomic under the row lock that
// ON CONFLICT DO UPDATE takes. Every CASE reads the row as it was before
// this statement (rate_limit_counters.*), the new window comes from EXCLUDED.
const INCREMENT_SQL = `
  INSERT INTO rate_limit_counters AS c (key_hash, hits, expires_at)
  VALUES ($1, 1, now() + $2::integer * interval '1 millisecond')
  ON CONFLICT (key_hash) DO UPDATE SET
    hits       = CASE WHEN c.expires_at <= now() THEN 1 ELSE c.hits + 1 END,
    expires_at = CASE WHEN c.expires_at <= now() THEN EXCLUDED.expires_at ELSE c.expires_at END
  RETURNING
    hits,
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (expires_at - now())) * 1000))::integer AS ttl_ms
`;

const CLEANUP_SQL = 'DELETE FROM rate_limit_counters WHERE expires_at < now()';

export interface PgRateLimitStoreOptions {
  /** Minimum time between two cleanups started by this store. */
  readonly cleanupIntervalMs?: number;
  /** Clock for the cleanup schedule; tests inject one. */
  readonly now?: () => number;
}

export function hashRateLimitKey(key: string): Buffer {
  return createHash('sha256').update(key, 'utf8').digest();
}

/** Deletes every counter whose window has ended. Returns how many rows went. */
export async function deleteExpiredRateLimitCounters(pool: RateLimitPool): Promise<number> {
  const result = await pool.query(CLEANUP_SQL);
  return result.rowCount ?? 0;
}

/**
 * Returns the constructor @fastify/rate-limit expects as its `store` option.
 * The plugin calls `new Store(options)` once and `child()` per limiter.
 */
export function createPgRateLimitStore(
  pool: RateLimitPool,
  options: PgRateLimitStoreOptions = {}
): FastifyRateLimitStoreCtor {
  const cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
  const now = options.now ?? Date.now;
  // Shared by the store and all its children: one schedule per instance.
  let lastCleanupAt = now();

  function maybeCleanUp(): void {
    if (now() - lastCleanupAt < cleanupIntervalMs) return;
    lastCleanupAt = now();
    // Fire and forget: a failed cleanup only leaves expired rows behind,
    // and those are reset on their next hit anyway.
    deleteExpiredRateLimitCounters(pool).catch(() => undefined);
  }

  class PgRateLimitStore implements FastifyRateLimitStore {
    incr(
      key: string,
      callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
      timeWindow: number
    ): void {
      pool
        .query<{ hits: number; ttl_ms: number }>(INCREMENT_SQL, [hashRateLimitKey(key), timeWindow])
        .then(
          (result) => {
            const row = result.rows[0];
            if (row === undefined) {
              callback(new Error('rate-limit increment returned no row'));
              return;
            }
            callback(null, { current: row.hits, ttl: row.ttl_ms });
            maybeCleanUp();
          },
          (error: unknown) => {
            callback(error instanceof Error ? error : new Error(String(error)));
          }
        );
    }

    child(): FastifyRateLimitStore {
      // Stateless: the database holds the counters, the key holds the bucket.
      return this;
    }
  }

  return PgRateLimitStore;
}
