import { Pool } from 'pg';

import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { queryPostgisVersion } from './health.js';

const config = readConfig();
const pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
const app = buildApp({
  queryPostgisVersion: () => queryPostgisVersion(pool)
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
};

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
