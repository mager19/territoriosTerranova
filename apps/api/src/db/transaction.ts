/**
 * Runs `work` inside a single BEGIN/COMMIT/ROLLBACK transaction on one
 * checked-out client, so a territory (or revision) and its audit event
 * commit atomically — an audit event that silently failed to write would
 * leave a transition nobody can account for (AGENTS.md).
 *
 * Accepts `Pick<Pool, 'connect'>` rather than the concrete `pg.Pool` type so
 * tests can inject a fake pool/client pair without a real database.
 */

import type { Pool, PoolClient } from 'pg';

export type TransactionalPool = Pick<Pool, 'connect'>;

export async function withTransaction<T>(
  pool: TransactionalPool,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
