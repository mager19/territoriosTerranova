/**
 * Admin progress-entry routes — slice 3 of the A3 brief. Progress is scoped
 * to its assignment (progress_entries.assignment_id is the real FK; there
 * is no territory_id on the table), matching how return/complete/reopen
 * are also assignment-scoped in slice 2.
 */

import type { FastifyInstance } from 'fastify';

import { listProgressEntries, recordProgress } from '../../domain/progress.js';
import { isRecord, trySendDomainError } from './error-response.js';
import type { TransactionalPool } from '../../db/transaction.js';

export interface AdminProgressRouteDeps {
  readonly pool: TransactionalPool;
}

export function registerAdminProgressRoutes(app: FastifyInstance, deps: AdminProgressRouteDeps): void {
  app.post<{ Params: { id: string } }>('/admin/assignments/:id/progress', async (request, reply) => {
    const assignmentId = Number(request.params.id);
    if (!Number.isInteger(assignmentId) || assignmentId < 1) {
      return reply.status(400).send({ error: 'invalid_request', message: 'assignment id must be a positive integer' });
    }
    const body = isRecord(request.body) ? request.body : {};
    try {
      const entry = await recordProgress(deps.pool, assignmentId, {
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

  app.get<{ Params: { id: string } }>('/admin/assignments/:id/progress', async (request, reply) => {
    const assignmentId = Number(request.params.id);
    if (!Number.isInteger(assignmentId) || assignmentId < 1) {
      return reply.status(400).send({ error: 'invalid_request', message: 'assignment id must be a positive integer' });
    }
    try {
      const entries = await listProgressEntries(deps.pool, assignmentId);
      return reply.status(200).send({ entries });
    } catch (error) {
      if (trySendDomainError(reply, error)) return;
      throw error;
    }
  });
}
