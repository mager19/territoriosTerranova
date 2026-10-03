/**
 * The public, read-only endpoints (A4 brief): the original token route,
 * where the token IS the authorization, and the fixed slug route
 * (2026-10-03), where anyone who knows a territory's slug may read its
 * public view. Both return the same allowlisted body. A4 owns this file and
 * apps/api/src/sharing/**; it never touches admin routes or the domain
 * layer (AGENTS.md, A4 brief: "Do not modify apps/api/src/domain/** or
 * admin routes").
 */

import type { FastifyInstance, FastifyReply } from 'fastify';

import { rateLimitKey } from '../../rate-limit/keys.js';
import {
  resolvePublicTerritoryView,
  resolvePublicTerritoryViewBySlug,
  type PublicTerritoryView
} from '../../sharing/repository.js';
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

/**
 * The ONE place the public response body is built, shared by the token and
 * the slug route. Explicit allowlist, field by field — never spread a domain
 * object. This is the complete public response shape; see
 * integration/sharing.test.ts for the tests that pin it on both routes.
 * `route` (2026-09-08), the merged current-cycle `coveredArea` (2026-09-26),
 * and the latest session `note` (2026-10-03, replacing the former
 * `pausePoint`) are the deliberate exceptions to the "exclude everything but
 * the territory/coverage shape" rule — product decisions recorded in
 * AGENTS.md "Privacy rules". A null view is ONE neutral 404 for every reason.
 */
function sendPublicView(reply: FastifyReply, view: PublicTerritoryView | null): FastifyReply {
  if (view === null) {
    return reply.status(404).send({ error: 'not_found' });
  }
  return reply.status(200).send({
    territoryName: view.territoryName,
    boundary: view.boundary,
    remainingArea: view.remainingArea,
    remainingAreaStatus: view.remainingAreaStatus,
    route: view.route,
    note: view.note,
    coveredArea: view.coveredArea
  });
}

export async function registerPublicTerritoryRoutes(
  app: FastifyInstance,
  deps: PublicTerritoryRouteDeps
): Promise<void> {
  // @fastify/rate-limit is registered once, non-global, in app.ts (the
  // admin sign-in routes use it too): nothing is rate limited unless a
  // route attaches a limit. Each public route gets two independent limits
  // — per IP and per token/slug — and both must pass. Both routes share the
  // ONE `public-ip` bucket, so switching URL forms never doubles a client's
  // allowance. Each key names its bucket, because the store may be shared
  // by every limiter and every API instance (rate-limit/pg-store.ts).
  const perIpLimit = {
    max: 30,
    timeWindow: '1 minute',
    keyGenerator: (request: { ip: string }) => rateLimitKey('public-ip', request.ip)
  };

  app.get<{ Params: { token: string } }>(
    '/public/territories/:token',
    {
      preHandler: [
        app.rateLimit(perIpLimit),
        app.rateLimit({
          max: 60,
          timeWindow: '1 minute',
          keyGenerator: (request) => `share-token:${(request.params as { token: string }).token}`
        })
      ]
    },
    async (request, reply) => {
      setPublicSecurityHeaders(reply);
      // Revoked, expired, wrong scope, and genuinely nonexistent are ALL
      // one identical 404 — A4 hard constraint: `view` is already collapsed
      // to null | valid by resolvePublicTerritoryView.
      return sendPublicView(reply, await resolvePublicTerritoryView(deps.pool, request.params.token));
    }
  );

  // The fixed, readable URL (2026-10-03 product decision, AGENTS.md
  // "Privacy rules"): no token, the slug names the territory. The token
  // route above stays for links already sent.
  app.get<{ Params: { slug: string } }>(
    '/public/t/:slug',
    {
      preHandler: [
        app.rateLimit(perIpLimit),
        app.rateLimit({
          max: 60,
          timeWindow: '1 minute',
          keyGenerator: (request) => `share-slug:${(request.params as { slug: string }).slug}`
        })
      ]
    },
    async (request, reply) => {
      setPublicSecurityHeaders(reply);
      return sendPublicView(reply, await resolvePublicTerritoryViewBySlug(deps.pool, request.params.slug));
    }
  );
}
