/**
 * The ONE public, read-only endpoint (A4 brief). No authentication beyond
 * the token itself; the token IS the authorization. A4 owns this file and
 * apps/api/src/sharing/**; it never touches admin routes or the domain
 * layer (AGENTS.md, A4 brief: "Do not modify apps/api/src/domain/** or
 * admin routes").
 */

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

import { resolvePublicTerritoryView } from '../../sharing/repository.js';
import type { TransactionalPool } from '../../db/transaction.js';

export interface PublicTerritoryRouteDeps {
  readonly pool: TransactionalPool;
}

/**
 * Security headers applied to EVERY response from this route, success or
 * 404 alike — a cached or indexed 404 for a guessed token is still a leak
 * of "this endpoint exists and answers this shape" (AGENTS.md).
 */
function setPublicSecurityHeaders(reply: { header: (name: string, value: string) => void }): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('X-Robots-Tag', 'noindex, nofollow');
  reply.header('Referrer-Policy', 'no-referrer');
}

export async function registerPublicTerritoryRoutes(
  app: FastifyInstance,
  deps: PublicTerritoryRouteDeps
): Promise<void> {
  // Registered non-global: nothing else on this Fastify instance is rate
  // limited by this registration. Two independent limits are attached
  // below directly to the one public route — per IP (default key) and per
  // token (custom key) — both must pass.
  await app.register(rateLimit, { global: false });

  app.get<{ Params: { token: string } }>(
    '/public/territories/:token',
    {
      preHandler: [
        app.rateLimit({ max: 30, timeWindow: '1 minute' }),
        app.rateLimit({
          max: 60,
          timeWindow: '1 minute',
          keyGenerator: (request) => `share-token:${(request.params as { token: string }).token}`
        })
      ]
    },
    async (request, reply) => {
      setPublicSecurityHeaders(reply);

      const view = await resolvePublicTerritoryView(deps.pool, request.params.token);
      if (view === null) {
        // Revoked, expired, wrong scope, and genuinely nonexistent are
        // ALL this exact response — A4 hard constraint. There is no
        // branch anywhere in this handler that could accidentally
        // distinguish them: `view` is already collapsed to null | valid
        // by resolvePublicTerritoryView.
        return reply.status(404).send({ error: 'not_found' });
      }

      // Explicit allowlist, field by field — never spread a domain
      // object. This is the complete public response shape; see
      // sharing/repository.test.ts for the test that pins it.
      return reply.status(200).send({
        territoryName: view.territoryName,
        boundary: view.boundary,
        remainingArea: view.remainingArea,
        remainingAreaStatus: view.remainingAreaStatus
      });
    }
  );
}
