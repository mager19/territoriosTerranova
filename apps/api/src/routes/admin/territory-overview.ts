/**
 * Administrator overview. Registered under /admin/territories/overview by
 * app.ts — a static segment, which Fastify's router resolves ahead of the
 * sibling /admin/territories/:id route.
 *
 * Deliberately a separate endpoint rather than an extension of
 * GET /admin/territories: that list exists to populate a selector and needs
 * only names, so making it carry a year of aggregates would slow the common
 * path for data it rarely needs.
 */

import type { FastifyInstance } from 'fastify';

import { getTerritoryOverview } from '../../domain/territory-overview.js';
import type { TransactionalPool } from '../../db/transaction.js';

export interface AdminTerritoryOverviewRouteDeps {
  readonly pool: TransactionalPool;
}

const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 24;

export function registerAdminTerritoryOverviewRoutes(
  app: FastifyInstance,
  deps: AdminTerritoryOverviewRouteDeps
): void {
  app.get<{ Querystring: { months?: string; includeArchived?: string } }>(
    '/admin/territories/overview',
    async (request, reply) => {
      const rawMonths = request.query.months;
      const months = rawMonths === undefined ? DEFAULT_MONTHS : Number(rawMonths);
      if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) {
        return reply
          .status(400)
          .send({ error: 'invalid_request', message: `months must be an integer between 1 and ${MAX_MONTHS}` });
      }

      const includeArchived = request.query.includeArchived === 'true';

      const territories = await getTerritoryOverview(deps.pool, { months, includeArchived });
      return reply.status(200).send({ territories });
    }
  );
}
