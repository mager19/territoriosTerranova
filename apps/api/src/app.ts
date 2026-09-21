import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerAdminProgressRoutes } from './routes/admin/progress.js';
import { registerAdminReferenceBarrioRoutes } from './routes/admin/reference-barrios.js';
import { registerAdminShareTokenRoutes } from './routes/admin/share-tokens.js';
import { registerAdminTerritoryOverviewRoutes } from './routes/admin/territory-overview.js';
import { registerAdminTerritoryRoutes } from './routes/admin/territories.js';
import { registerPublicTerritoryRoutes } from './routes/public/territories.js';
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
   * main.ts always provides it; admin/public routes register only when
   * present (A3 admin routes, A4 the public one).
   */
  readonly pool?: TransactionalPool;
}

export interface BuildAppOptions {
  readonly logger?: boolean;
}

/**
 * Async because the public route registers @fastify/rate-limit and then
 * synchronously reads the `app.rateLimit` decorator it creates
 * (routes/public/territories.ts) — that decorator only exists once the
 * plugin's own registration has actually resolved. Fastify's own docs
 * pattern this as `await fastify.register(...)` before using the
 * decorator; calling that without awaiting here would race app.listen()/
 * app.inject() in the caller. Every caller must `await buildApp(...)`.
 */
export async function buildApp(
  deps: AppDependencies,
  options: BuildAppOptions = {}
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true });

  // Admin/public are separate Vite dev servers (apps/admin :5173,
  // apps/public :5174), cross-origin from the API (:3000). Restricted to
  // exactly those two known local dev origins — never '*'. This is
  // deliberately dev-scoped: a real deployment topology (reverse proxy,
  // same-origin, or a production allowlist) is a "still open" production
  // decision (docs/agents/README.md), not decided here.
  void app.register(cors, {
    origin: ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost:5174']
  });

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
    registerAdminTerritoryOverviewRoutes(app, { pool: deps.pool });
    registerAdminProgressRoutes(app, { pool: deps.pool });
    registerAdminShareTokenRoutes(app, { pool: deps.pool });
    registerAdminReferenceBarrioRoutes(app, { pool: deps.pool });
    await registerPublicTerritoryRoutes(app, { pool: deps.pool });
  }

  return app;
}
