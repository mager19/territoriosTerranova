import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import type { AdminAuthConfig } from './config.js';
import { registerAdminGuard } from './auth/admin-guard.js';
import { createPgAdminSessionStore, type AdminSessionStore } from './auth/session-store.js';
import { registerAdminAuthRoutes } from './routes/admin/auth.js';

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
  /**
   * Required whenever `pool` is given: admin routes never register without
   * their session guard (docs/admin-auth.md).
   */
  readonly auth?: AdminAuthDependencies;
}

export interface AdminAuthDependencies {
  readonly config: AdminAuthConfig;
  /** Defaults to the PostgreSQL store over `pool`; unit tests inject an in-memory one. */
  readonly sessions?: AdminSessionStore;
}

export interface BuildAppOptions {
  readonly logger?: boolean;
  /** Fastify `trustProxy` (config.trustProxy): needed for per-IP rate limits behind a proxy. */
  readonly trustProxy?: boolean | number;
}

/**
 * Async because @fastify/rate-limit and @fastify/cookie are registered here
 * and their decorators (`app.rateLimit`, `reply.setCookie`) are used by the
 * routes registered right after — those decorators only exist once the
 * plugin's own registration has actually resolved. Fastify's own docs
 * pattern this as `await fastify.register(...)` before using the
 * decorator; calling that without awaiting here would race app.listen()/
 * app.inject() in the caller. Every caller must `await buildApp(...)`.
 */
export async function buildApp(
  deps: AppDependencies,
  options: BuildAppOptions = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    // Fastify accepts a hop count at runtime ("trust the nth hop"), but its
    // type declarations omit `number`; the cast only bridges that gap.
    trustProxy: (options.trustProxy ?? false) as boolean
  });

  // The admin app calls the API same-origin through a /api proxy (Vite in
  // development, a Vercel rewrite in production — docs/admin-auth.md), so it
  // needs no CORS entry; its session cookie is never sent cross-origin.
  // Only apps/public's local dev server (:5174) is cross-origin. Never '*'.
  // A production public-app origin is a still-open deployment decision.
  void app.register(cors, {
    origin: ['http://127.0.0.1:5174', 'http://localhost:5174']
  });

  // Registered once, non-global: only routes that attach a limit are limited
  // (the public share route and the admin sign-in/out routes).
  await app.register(rateLimit, { global: false });

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
    const auth = deps.auth;
    if (auth === undefined) {
      throw new Error('admin routes require auth dependencies (deps.auth); refusing to register them unguarded');
    }
    const sessions = auth.sessions ?? createPgAdminSessionStore(deps.pool);
    await app.register(cookie);
    // Before any admin route: the guard attaches itself through onRoute.
    registerAdminGuard(app, { sessions, allowedOrigins: auth.config.allowedOrigins });
    registerAdminAuthRoutes(app, {
      config: auth.config,
      sessions,
      // Per client IP (behind a proxy this needs TRUST_PROXY, docs/admin-auth.md).
      loginRateLimit: app.rateLimit({ max: 5, timeWindow: '15 minutes' }),
      logoutRateLimit: app.rateLimit({ max: 30, timeWindow: '1 minute' })
    });
    registerAdminTerritoryRoutes(app, { pool: deps.pool });
    registerAdminTerritoryOverviewRoutes(app, { pool: deps.pool });
    registerAdminProgressRoutes(app, { pool: deps.pool });
    registerAdminShareTokenRoutes(app, { pool: deps.pool });
    registerAdminReferenceBarrioRoutes(app, { pool: deps.pool });
    await registerPublicTerritoryRoutes(app, { pool: deps.pool });
  }

  return app;
}
