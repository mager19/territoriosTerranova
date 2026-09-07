/**
 * Database CLI for the repository. Run from packages/geo:
 *
 *   pnpm --filter @territorios/geo db:migrate
 *
 * Reads DATABASE_URL (defaults to the docker-compose.yml connection).
 * The root-level `pnpm db:migrate` alias belongs to the root package.json,
 * which is A1-owned; the orchestrator wires it to this command.
 */

import { DEFAULT_DATABASE_URL, runMigrations } from './migrate.js';

const command = process.argv[2];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

  switch (command) {
    case 'migrate': {
      const result = await runMigrations(databaseUrl, {
        log: (message) => console.log(`[db] ${message}`)
      });
      console.log(
        `[db] migrations applied: ${result.applied.length}, already up to date: ${result.upToDate.length}`
      );
      return;
    }
    default:
      console.error(`[db] unknown command: ${command ?? '(none)'} — expected: migrate`);
      process.exitCode = 1;
  }
}

await main();
