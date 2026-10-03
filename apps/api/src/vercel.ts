/**
 * The API as one Vercel Function (docs/deploy-vercel.md). The admin project
 * serves it from apps/admin/api/index.js, which only re-exports `handler`;
 * apps/admin/vercel.json rewrites every /api/* request to that function.
 *
 * One Fastify app per function instance, built on the first request and
 * reused (module scope), with the shared PostgreSQL rate-limit store and a
 * small pg pool. The request keeps Fastify's own routing: the handler strips
 * the /api prefix the admin app uses and emits the untouched Node request
 * into Fastify's server, so headers, cookies, and bodies reach the API
 * exactly as they do behind the local Vite proxy.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { finished } from 'node:stream/promises';

import { attachDatabasePool } from '@vercel/functions';
import type { FastifyInstance } from 'fastify';

import { readConfig } from './config.js';
import { createApi, type PoolDefaults } from './create-api.js';

/** The same-origin prefix the admin app calls the API under. */
export const API_PREFIX = '/api';

/**
 * Query parameter apps/admin/vercel.json's rewrite carries the original path
 * in (`/api/(.*)` → `/api?__path=$1`). Vercel normally hands the function the
 * original URL; the parameter keeps routing correct if it hands over the
 * rewritten one instead. It is always removed before Fastify sees the URL.
 */
export const ROUTED_PATH_PARAM = '__path';

/**
 * Per instance. Fluid compute serves concurrent requests from one instance,
 * so a few connections; Neon's pooler (the -pooler host) multiplexes all
 * instances onto its own connections. Override with PG_POOL_MAX /
 * PG_IDLE_TIMEOUT_MS.
 */
export const SERVERLESS_POOL_DEFAULTS: PoolDefaults = { max: 3, idleTimeoutMillis: 5_000 };

/**
 * Maps the URL Vercel delivers to the API's own route URL:
 * `/api/admin/me?x=1` → `/admin/me?x=1`, and the rewritten form
 * `/api?__path=admin/me&x=1` → `/admin/me?x=1`.
 */
export function toApiUrl(rawUrl: string | undefined): string {
  const url = new URL(rawUrl ?? '/', 'http://function.invalid');
  const routedPath = url.searchParams.get(ROUTED_PATH_PARAM);
  url.searchParams.delete(ROUTED_PATH_PARAM);

  let pathname = url.pathname;
  if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) {
    pathname = pathname.slice(API_PREFIX.length);
  }
  if ((pathname === '' || pathname === '/') && routedPath !== null) {
    pathname = `/${routedPath.replace(/^\/+/, '')}`;
  }
  url.pathname = pathname === '' ? '/' : pathname;
  return `${url.pathname}${url.search}`;
}

export type NodeRequestHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

/**
 * Wraps an app factory as a Node.js `(request, response)` Vercel Function.
 * The factory runs once per instance; if it fails (a configuration error,
 * say), that request gets a bare 500 and the next request tries again.
 */
export function createVercelHandler(loadApp: () => Promise<FastifyInstance>): NodeRequestHandler {
  let ready: Promise<FastifyInstance> | undefined;

  return async (request, response) => {
    ready ??= loadApp().then(async (app) => {
      await app.ready();
      return app;
    });

    let app: FastifyInstance;
    try {
      app = await ready;
    } catch (error) {
      ready = undefined;
      // Only the message: never dump the environment or the request.
      console.error('API failed to start:', error instanceof Error ? error.message : String(error));
      response.statusCode = 500;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({ error: 'internal_error' }));
      return;
    }

    request.url = toApiUrl(request.url);
    app.server.emit('request', request, response);
    // Resolve only once Fastify has answered, so the invocation is not
    // considered done while the response is still being written.
    await finished(response).catch(() => undefined);
  };
}

/** The production app for one function instance, configured from the environment. */
export async function createServerlessApp(env: NodeJS.ProcessEnv = process.env): Promise<FastifyInstance> {
  const { app, pool } = await createApi(readConfig(env), { poolDefaults: SERVERLESS_POOL_DEFAULTS });
  // Releases idle connections before Vercel suspends the instance (Fluid
  // compute); a no-op outside Vercel.
  attachDatabasePool(pool);
  return app;
}

export const handler: NodeRequestHandler = createVercelHandler(() => createServerlessApp());
