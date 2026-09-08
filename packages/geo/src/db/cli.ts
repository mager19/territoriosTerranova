/**
 * Database CLI for the repository. Run from packages/geo:
 *
 *   pnpm --filter @territorios/geo db:migrate
 *   pnpm --filter @territorios/geo db:seed
 *   pnpm --filter @territorios/geo db:fetch-amva   (online; refreshes the cache)
 *
 * Reads DATABASE_URL (defaults to the docker-compose.yml connection).
 * The root-level `pnpm db:migrate` / `pnpm db:seed` aliases belong to the
 * root package.json, which is A1-owned; the orchestrator wires them to these
 * commands.
 */

import { DEFAULT_DATABASE_URL, runMigrations } from './migrate.js';
import { DEFAULT_CACHE_DIR, runSeed } from './seed.js';
import { fetchAmvaCache } from './fetch-amva.js';

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
    case 'seed': {
      const result = await runSeed(databaseUrl);
      console.log(
        `[db] seeded ${result.barrios} barrios and ${result.boundary} municipal boundary (idempotent full replacement)`
      );
      return;
    }
    case 'fetch-amva': {
      const manifest = await fetchAmvaCache(DEFAULT_CACHE_DIR);
      console.log(
        `[db] cached ${manifest.layers.barrios.count} barrios + ${manifest.layers.municipalBoundary.count} boundary at ${manifest.fetchedAt}`
      );
      return;
    }
    default:
      console.error(`[db] unknown command: ${command ?? '(none)'} — expected: migrate | seed | fetch-amva`);
      process.exitCode = 1;
  }
}

await main();
