/**
 * Forward-only SQL migration runner.
 *
 * Lives in packages/geo because db/ is not a pnpm workspace (workspace globs
 * are A1-owned) and this runner needs the `pg` dependency; packages/geo is
 * the only workspace A2 owns. The migrations themselves live in
 * db/migrations/*.sql at the repository root — plain SQL, hand-written, no
 * ORM (stack decision in docs/agents/README.md).
 *
 * Forward-only means:
 *   - files are applied once, in lexicographic order, each in its own
 *     transaction;
 *   - the SHA-256 checksum of every applied file is recorded, and re-running
 *     against a modified file aborts instead of drifting;
 *   - there is no down/rollback path. Fix mistakes with a new migration.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repository root, resolved from src/db or dist/db (both four levels down). */
export const REPO_ROOT = path.resolve(HERE, '../../../..');

export const DEFAULT_MIGRATIONS_DIR = path.join(REPO_ROOT, 'db', 'migrations');

/** Matches docker-compose.yml; a plain local setup needs no .env. */
export const DEFAULT_DATABASE_URL =
  'postgres://territorios:territorios@127.0.0.1:5432/territorios';

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly upToDate: readonly string[];
}

export interface MigrateOptions {
  readonly migrationsDir?: string;
  readonly log?: (message: string) => void;
}

export function listMigrationFiles(dir: string = DEFAULT_MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
}

export async function runMigrations(
  databaseUrl: string,
  options: MigrateOptions = {}
): Promise<MigrationResult> {
  const dir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const log = options.log ?? ((): void => undefined);
  const files = listMigrationFiles(dir);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const recorded = await client.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM schema_migrations'
    );
    const checksums = new Map(recorded.rows.map((row) => [row.filename, row.checksum]));

    const applied: string[] = [];
    const upToDate: string[] = [];

    for (const filename of files) {
      const sql = readFileSync(path.join(dir, filename), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = checksums.get(filename);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `forward-only violation: ${filename} was modified after being applied ` +
              `(recorded ${previous.slice(0, 12)}, current ${checksum.slice(0, 12)}). ` +
              `Never edit an applied migration; add a new one.`
          );
        }
        upToDate.push(filename);
        continue;
      }

      log(`applying ${filename}`);
      await client.query('BEGIN');
      try {
        // The whole file runs as one simple query inside one transaction:
        // a migration either lands completely or not at all.
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [filename, checksum]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      applied.push(filename);
    }

    return { applied, upToDate };
  } finally {
    await client.end();
  }
}
