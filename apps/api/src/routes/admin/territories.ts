/**
 * Admin territory routes — slice 1 of the A3 brief. Registered under
 * /admin/territories by app.ts. Administrator-authenticated (A3 owns this
 * boundary; A4 owns the public one — a share token must never reach these
 * routes, and these routes never accept one).
 */

import type { FastifyInstance } from 'fastify';

import { isDomainError, type DomainError } from '../../domain/errors.js';
import {
  createTerritory,
  getTerritoryWithRevisions,
  listTerritories,
  submitRevision
} from '../../domain/territories.js';
import type { TransactionalPool } from '../../db/transaction.js';

export interface AdminTerritoryRouteDeps {
  readonly pool: TransactionalPool;
}

/**
 * Every domain error carries a distinct `code` (AGENTS.md: never a generic
 * 400). Status choice: 400 for a problem with the request's own input
 * (invalid/zero-area geometry, out of bounds, blank fields), 404 for a
 * missing territory, 409 for a real conflict with another territory's
 * state (unauthorized overlap), 503 for an operational precondition this
 * request cannot fix (the boundary reference itself is missing).
 */
function statusForDomainError(error: DomainError): number {
  switch (error.code) {
    case 'invalid_geometry':
    case 'zero_area_geometry':
    case 'out_of_bounds':
    case 'invalid_request':
      return 400;
    case 'territory_not_found':
      return 404;
    case 'unauthorized_overlap':
      return 409;
    case 'boundary_reference_missing':
      return 503;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function registerAdminTerritoryRoutes(app: FastifyInstance, deps: AdminTerritoryRouteDeps): void {
  app.post('/admin/territories', async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {};
    try {
      const territory = await createTerritory(deps.pool, {
        name: typeof body.name === 'string' ? body.name : '',
        geometry: body.geometry,
        author: typeof body.author === 'string' ? body.author : ''
      });
      return reply.status(201).send(territory);
    } catch (error) {
      if (isDomainError(error)) {
        return reply.status(statusForDomainError(error)).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get('/admin/territories', async (_request, reply) => {
    const territories = await listTerritories(deps.pool);
    return reply.status(200).send({ territories });
  });

  app.get<{ Params: { id: string } }>('/admin/territories/:id', async (request, reply) => {
    const territoryId = Number(request.params.id);
    if (!Number.isInteger(territoryId) || territoryId < 1) {
      return reply.status(400).send({ error: 'invalid_request', message: 'territory id must be a positive integer' });
    }
    try {
      const territory = await getTerritoryWithRevisions(deps.pool, territoryId);
      return reply.status(200).send(territory);
    } catch (error) {
      if (isDomainError(error)) {
        return reply.status(statusForDomainError(error)).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>('/admin/territories/:id/revisions', async (request, reply) => {
    const territoryId = Number(request.params.id);
    if (!Number.isInteger(territoryId) || territoryId < 1) {
      return reply.status(400).send({ error: 'invalid_request', message: 'territory id must be a positive integer' });
    }
    const body = isRecord(request.body) ? request.body : {};
    try {
      const revision = await submitRevision(deps.pool, territoryId, {
        geometry: body.geometry,
        author: typeof body.author === 'string' ? body.author : ''
      });
      return reply.status(201).send(revision);
    } catch (error) {
      if (isDomainError(error)) {
        return reply.status(statusForDomainError(error)).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });
}
