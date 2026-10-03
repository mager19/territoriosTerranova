/**
 * Production wiring shared by both entry points: main.ts (a long-running
 * local or self-hosted server) and vercel.ts (the Vercel Function,
 * docs/deploy-vercel.md). It owns the PostgreSQL pool and hands the app the
 * shared PostgreSQL rate-limit store, so limits hold across every instance.
 */

import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';

import { buildApp } from './app.js';
import type { ApiConfig } from './config.js';
import { queryPostgisVersion } from './health.js';
import { createPgRateLimitStore } from './rate-limit/pg-store.js';

export interface PoolDefaults {
  /** Used when PG_POOL_MAX is unset. */
  readonly max: number;
  /** Used when PG_IDLE_TIMEOUT_MS is unset; undefined keeps pg's own default. */
  readonly idleTimeoutMillis?: number;
}

export interface CreateApiOptions {
  readonly poolDefaults: PoolDefaults;
  readonly logger?: boolean;
}

export interface CreatedApi {
  readonly app: FastifyInstance;
  readonly pool: Pool;
}

export async function createApi(config: ApiConfig, options: CreateApiOptions): Promise<CreatedApi> {
  const idleTimeoutMillis = config.databasePool.idleTimeoutMillis ?? options.poolDefaults.idleTimeoutMillis;
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePool.max ?? options.poolDefaults.max,
    ...(idleTimeoutMillis === undefined ? {} : { idleTimeoutMillis })
  });
  try {
    const app: FastifyInstance = await buildApp(
      {
        queryPostgisVersion: () => queryPostgisVersion(pool),
        pool,
        auth: { config: config.auth }
      },
      {
        ...(options.logger === undefined ? {} : { logger: options.logger }),
        trustProxy: config.trustProxy,
        publicAppOrigins: config.publicAppOrigins,
        rateLimitStore: createPgRateLimitStore(pool)
      }
    );
    // An idle connection can die underneath the pool (Neon suspends idle
    // computes; its pooler recycles connections). pg reports that as an
    // 'error' event, which would crash the process if nobody listened.
    pool.on('error', (error) => {
      app.log.warn({ err: error }, 'idle database connection lost');
    });
    return { app, pool };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
