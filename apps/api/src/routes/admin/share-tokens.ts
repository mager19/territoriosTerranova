/**
 * Admin actions on share tokens — create and revoke. A4 owns the sharing
 * domain logic (apps/api/src/sharing/**) and the public route; these are
 * the ADMIN-facing entry points into that logic, and so live under
 * routes/admin/** alongside A3's other admin routes rather than under A4's
 * own owned paths (A4's brief: "Do not modify ... admin routes. Request
 * changes from the orchestrator" — this is that requested change, made
 * directly since this session is also the orchestrator).
 */

import type { FastifyInstance } from 'fastify';

import { createShareToken, revokeShareToken } from '../../sharing/repository.js';
import { isRecord, trySendDomainError } from './error-response.js';
import type { TransactionalPool } from '../../db/transaction.js';

export interface AdminShareTokenRouteDeps {
  readonly pool: TransactionalPool;
}

export function registerAdminShareTokenRoutes(app: FastifyInstance, deps: AdminShareTokenRouteDeps): void {
  app.post<{ Params: { id: string } }>('/admin/assignments/:id/share-tokens', async (request, reply) => {
    const assignmentId = Number(request.params.id);
    if (!Number.isInteger(assignmentId) || assignmentId < 1) {
      return reply.status(400).send({ error: 'invalid_request', message: 'assignment id must be a positive integer' });
    }
    const body = isRecord(request.body) ? request.body : {};
    let expiresAt: Date | undefined;
    if (typeof body.expiresAt === 'string') {
      const parsed = new Date(body.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        return reply.status(400).send({ error: 'invalid_request', message: 'expiresAt must be a valid ISO 8601 date' });
      }
      expiresAt = parsed;
    }

    try {
      const created = await createShareToken(deps.pool, { assignmentId, expiresAt });
      // The ONLY response in the system that ever contains the plaintext
      // token. Never logged (request logging in main.ts/app.ts logs
      // method/path/status, never body), never stored again after this.
      return reply.status(201).send({
        id: created.id,
        token: created.token,
        assignmentId: created.assignmentId,
        createdAt: created.createdAt,
        expiresAt: created.expiresAt
      });
    } catch (error) {
      if (trySendDomainError(reply, error)) return;
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>('/admin/share-tokens/:id/revoke', async (request, reply) => {
    const tokenId = Number(request.params.id);
    if (!Number.isInteger(tokenId) || tokenId < 1) {
      return reply.status(400).send({ error: 'invalid_request', message: 'token id must be a positive integer' });
    }
    await revokeShareToken(deps.pool, tokenId);
    return reply.status(204).send();
  });
}
