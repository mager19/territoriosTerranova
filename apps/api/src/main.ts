import { readConfig } from './config.js';
import { createApi } from './create-api.js';
import { createShutdown } from './shutdown.js';

const config = readConfig();
const { app, pool } = await createApi(config, { poolDefaults: { max: 5 } });

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
