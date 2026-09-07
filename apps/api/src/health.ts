import type { Pool } from 'pg';

/**
 * Live database probe: executes real SQL against the connection pool.
 * Returns the PostGIS version reported by the server, proving both
 * connectivity and that the PostGIS extension is usable.
 *
 * Throws when the database is unreachable or answers unexpectedly —
 * callers must treat a throw as "database down".
 */
export async function queryPostgisVersion(pool: Pick<Pool, 'query'>): Promise<string> {
  const result = await pool.query<{ version: string }>('SELECT postgis_version() AS version');
  const row = result.rows[0];
  if (row === undefined || typeof row.version !== 'string' || row.version.length === 0) {
    throw new Error('postgis_version() did not return a usable version string');
  }
  return row.version;
}
