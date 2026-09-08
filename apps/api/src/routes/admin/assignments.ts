/**
 * Admin assignment routes — slice 2 of the A3 brief. Assignment creation is
 * nested under its territory (POST /admin/territories/:id/assignments);
 * the return/complete/reopen transitions act directly on the assignment's
 * own id, since a caller acting on an assignment already has that id and
 * does not need its territory to do so.
 */

import type { FastifyInstance } from 'fastify';

import { assignTerritory, completeAssignment, reopenAssignment, returnAssignment } from '../../domain/assignments.js';
import { isRecord, trySendDomainError } from './error-response.js';
import type { TransactionalPool } from '../../db/transaction.js';

export interface AdminAssignmentRouteDeps {
  readonly pool: TransactionalPool;
}

function parsePositiveId(raw: string, reply: { status: (code: number) => { send: (body: unknown) => void } }): number | undefined {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    reply.status(400).send({ error: 'invalid_request', message: 'id must be a positive integer' });
    return undefined;
  }
  return id;
}

export function registerAdminAssignmentRoutes(app: FastifyInstance, deps: AdminAssignmentRouteDeps): void {
  app.post<{ Params: { id: string } }>('/admin/territories/:id/assignments', async (request, reply) => {
    const territoryId = parsePositiveId(request.params.id, reply);
    if (territoryId === undefined) return;

    const body = isRecord(request.body) ? request.body : {};
    try {
      const assignment = await assignTerritory(deps.pool, territoryId, {
        assignedTo: typeof body.assignedTo === 'string' ? body.assignedTo : '',
        assignedBy: typeof body.assignedBy === 'string' ? body.assignedBy : ''
      });
      return reply.status(201).send(assignment);
    } catch (error) {
      if (trySendDomainError(reply, error)) return;
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>('/admin/assignments/:id/return', async (request, reply) => {
    const assignmentId = parsePositiveId(request.params.id, reply);
    if (assignmentId === undefined) return;

    const body = isRecord(request.body) ? request.body : {};
    const actor = typeof body.actor === 'string' ? body.actor : '';
    if (actor.trim() === '') {
      return reply.status(400).send({ error: 'invalid_request', message: 'actor must not be blank' });
    }
    try {
      const assignment = await returnAssignment(deps.pool, assignmentId, actor);
      return reply.status(200).send(assignment);
    } catch (error) {
      if (trySendDomainError(reply, error)) return;
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>('/admin/assignments/:id/complete', async (request, reply) => {
    const assignmentId = parsePositiveId(request.params.id, reply);
    if (assignmentId === undefined) return;

    const body = isRecord(request.body) ? request.body : {};
    const actor = typeof body.actor === 'string' ? body.actor : '';
    if (actor.trim() === '') {
      return reply.status(400).send({ error: 'invalid_request', message: 'actor must not be blank' });
    }
    try {
      const assignment = await completeAssignment(deps.pool, assignmentId, actor);
      return reply.status(200).send(assignment);
    } catch (error) {
      if (trySendDomainError(reply, error)) return;
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>('/admin/assignments/:id/reopen', async (request, reply) => {
    const assignmentId = parsePositiveId(request.params.id, reply);
    if (assignmentId === undefined) return;

    const body = isRecord(request.body) ? request.body : {};
    const actor = typeof body.actor === 'string' ? body.actor : '';
    if (actor.trim() === '') {
      return reply.status(400).send({ error: 'invalid_request', message: 'actor must not be blank' });
    }
    try {
      const assignment = await reopenAssignment(deps.pool, assignmentId, {
        actor,
        reason: typeof body.reason === 'string' ? body.reason : ''
      });
      return reply.status(200).send(assignment);
    } catch (error) {
      if (trySendDomainError(reply, error)) return;
      throw error;
    }
  });
}
