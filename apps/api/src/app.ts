import Fastify, { type FastifyInstance } from 'fastify';

export interface AppDependencies {
  /**
   * Returns the live PostGIS version, or throws when the database is
   * unreachable. Injected so the health contract can be tested without
   * a database; production wiring lives in main.ts.
   */
  readonly queryPostgisVersion: () => Promise<string>;
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

  return app;
}
