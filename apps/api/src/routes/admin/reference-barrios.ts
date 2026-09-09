/**
 * Admin-only AMVA reference-barrio search. Registered under
 * /admin/reference/barrios by app.ts — never under /public/**, per A2's
 * hard constraint that AMVA attributes/source URLs never reach a public
 * path.
 */

import type { FastifyInstance } from 'fastify';

import { searchReferenceBarrios } from '../../domain/reference-barrios.js';
import type { TransactionalPool } from '../../db/transaction.js';

export interface AdminReferenceBarrioRouteDeps {
  readonly pool: TransactionalPool;
}

export function registerAdminReferenceBarrioRoutes(app: FastifyInstance, deps: AdminReferenceBarrioRouteDeps): void {
  app.get<{ Querystring: { name?: string } }>('/admin/reference/barrios', async (request, reply) => {
    const name = typeof request.query.name === 'string' ? request.query.name.trim() : '';
    if (name === '') {
      return reply.status(400).send({ error: 'invalid_request', message: 'a non-blank name query parameter is required' });
    }
    const barrios = await searchReferenceBarrios(deps.pool, name);
    return reply.status(200).send({ barrios });
  });
}
