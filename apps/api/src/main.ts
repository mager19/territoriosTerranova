import { Pool } from 'pg';

import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { queryPostgisVersion } from './health.js';
import { createShutdown } from './shutdown.js';

const config = readConfig();
const pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
const app = await buildApp(
  {
    queryPostgisVersion: () => queryPostgisVersion(pool),
    pool,
    auth: { config: config.auth }
  },
  { trustProxy: config.trustProxy }
);

const shutdown = createShutdown(app, pool);

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  await pool.end();
  process.exit(1);
}
