/**
 * Admin progress-entry routes. Progress is scoped directly to its
 * territory (progress_entries.territory_id) — 2026-09-08: territories are
 * shared to a group, not assigned to one person, so there is no assignment
 * to scope progress to anymore (db/migrations/
 * 0004_remove_individual_assignment.sql).
 */

import type { FastifyInstance } from 'fastify';

import { listProgressEntries, recordProgress } from '../../domain/progress.js';
import { changeTerritoryOperationalState, getTerritoryOperationalStatus, type OperationalAction } from '../../domain/territory-operational-state.js';
import { isRecord, trySendDomainError } from './error-response.js';
import type { TransactionalPool } from '../../db/transaction.js';

export interface AdminProgressRouteDeps {
  readonly pool: TransactionalPool;
}

export function registerAdminProgressRoutes(app: FastifyInstance, deps: AdminProgressRouteDeps): void {
  app.get<{ Params: { id: string } }>('/admin/territories/:id/operational-state', async (request, reply) => {
    const territoryId = Number(request.params.id);
    if (!Number.isInteger(territoryId) || territoryId < 1) {
      return reply.status(400).send({ error: 'invalid_request', message: 'territory id must be a positive integer' });
    }
    try {
      return reply.status(200).send(await getTerritoryOperationalStatus(deps.pool, territoryId));
    } catch (error) {
      if (trySendDomainError(reply, error)) return;
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>('/admin/territories/:id/operational-state', async (request, reply) => {
    const territoryId = Number(request.params.id);
    if (!Number.isInteger(territoryId) || territoryId < 1) {
      return reply.status(400).send({ error: 'invalid_request', message: 'territory id must be a positive integer' });
    }
    const body = isRecord(request.body) ? request.body : {};
    try {
      return reply.status(201).send(await changeTerritoryOperationalState(deps.pool, territoryId, {
        action: body.action as OperationalAction,
        actor: typeof body.actor === 'string' ? body.actor : '',
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        effectiveCompletionDate: typeof body.effectiveCompletionDate === 'string' ? body.effectiveCompletionDate : undefined
      }));
    } catch (error) {
      if (trySendDomainError(reply, error)) return;
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>('/admin/territories/:id/progress', async (request, reply) => {
    const territoryId = Number(request.params.id);
    if (!Number.isInteger(territoryId) || territoryId < 1) {
      return reply.status(400).send({ error: 'invalid_request', message: 'territory id must be a positive integer' });
    }
    const body = isRecord(request.body) ? request.body : {};
    try {
      const entry = await recordProgress(deps.pool, territoryId, {
        recordedBy: typeof body.recordedBy === 'string' ? body.recordedBy : '',
        note: typeof body.note === 'string' ? body.note : undefined,
        pausePoint: body.pausePoint,
        route: body.route,
        remainingArea: body.remainingArea
      });
      return reply.status(201).send(entry);
    } catch (error) {
      if (trySendDomainError(reply, error)) return;
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>('/admin/territories/:id/progress', async (request, reply) => {
    const territoryId = Number(request.params.id);
    if (!Number.isInteger(territoryId) || territoryId < 1) {
      return reply.status(400).send({ error: 'invalid_request', message: 'territory id must be a positive integer' });
    }
    try {
      const entries = await listProgressEntries(deps.pool, territoryId);
      return reply.status(200).send({ entries });
    } catch (error) {
      if (trySendDomainError(reply, error)) return;
      throw error;
    }
  });
}
