import Fastify, { type FastifyInstance } from 'fastify';

import { registerAdminAssignmentRoutes } from './routes/admin/assignments.js';
import { registerAdminProgressRoutes } from './routes/admin/progress.js';
import { registerAdminTerritoryRoutes } from './routes/admin/territories.js';
import type { TransactionalPool } from './db/transaction.js';

export interface AppDependencies {
  /**
   * Returns the live PostGIS version, or throws when the database is
   * unreachable. Injected so the health contract can be tested without
   * a database; production wiring lives in main.ts.
   */
  readonly queryPostgisVersion: () => Promise<string>;
  /**
   * Optional so app.test.ts's health-only builds keep working unchanged.
   * main.ts always provides it; admin territory routes register only when
   * present (A3, apps/api/src/domain + routes/admin + db).
   */
  readonly pool?: TransactionalPool;
}

export interface BuildAppOptions {
  readonly logger?: boolean;
}

export function buildApp(
  deps: AppDependencies,
  options: BuildAppOptions = {}
): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });

  // The health endpoint reflects real database state. It is never a
  // hardcoded {ok:true}: a failing probe answers 503.
  app.get('/health', async (request, reply) => {
    try {
      const postgisVersion = await deps.queryPostgisVersion();
      return reply.status(200).send({
        status: 'ok',
        database: { up: true, postgisVersion }
      });
    } catch (error) {
      request.log.error({ err: error }, 'database health check failed');
      return reply.status(503).send({
        status: 'unavailable',
        database: { up: false }
      });
    }
  });

  if (deps.pool) {
    registerAdminTerritoryRoutes(app, { pool: deps.pool });
    registerAdminAssignmentRoutes(app, { pool: deps.pool });
    registerAdminProgressRoutes(app, { pool: deps.pool });
  }

  return app;
}
