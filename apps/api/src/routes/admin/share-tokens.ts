/**
 * Admin actions on share tokens — create and revoke. A4 owns the sharing
 * domain logic (apps/api/src/sharing/**) and the public route; these are
 * the ADMIN-facing entry points into that logic, and so live under
 * routes/admin/** alongside A3's other admin routes rather than under A4's
 * own owned paths (A4's brief: "Do not modify ... admin routes. Request
 * changes from the orchestrator" — this is that requested change, made
 * directly since this session is also the orchestrator).
 *
 * A token now scopes to a whole territory, not a per-person assignment
 * (2026-09-08, db/migrations/0004_remove_individual_assignment.sql) —
 * "share this territory to the volunteer group" IS the admin action; there
 * is no separate assign step first.
 */

import type { FastifyInstance } from 'fastify';

import { createShareToken, revokeShareToken } from '../../sharing/repository.js';
import { isRecord, trySendDomainError } from './error-response.js';
import type { TransactionalPool } from '../../db/transaction.js';

export interface AdminShareTokenRouteDeps {
  readonly pool: TransactionalPool;
}

export function registerAdminShareTokenRoutes(app: FastifyInstance, deps: AdminShareTokenRouteDeps): void {
  app.post<{ Params: { id: string } }>('/admin/territories/:id/share-tokens', async (request, reply) => {
    const territoryId = Number(request.params.id);
    if (!Number.isInteger(territoryId) || territoryId < 1) {
      return reply.status(400).send({ error: 'invalid_request', message: 'territory id must be a positive integer' });
    }
    const body = isRecord(request.body) ? request.body : {};
    const createdBy = typeof body.createdBy === 'string' ? body.createdBy.trim() : '';
    if (createdBy === '') {
      return reply.status(400).send({ error: 'invalid_request', message: 'createdBy must not be blank' });
    }
    let expiresAt: Date | undefined;
    if (typeof body.expiresAt === 'string') {
      const parsed = new Date(body.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        return reply.status(400).send({ error: 'invalid_request', message: 'expiresAt must be a valid ISO 8601 date' });
      }
      expiresAt = parsed;
    }

    try {
      const created = await createShareToken(deps.pool, { territoryId, createdBy, expiresAt });
      // The ONLY response in the system that ever contains the plaintext
      // token. Never logged (request logging in main.ts/app.ts logs
      // method/path/status, never body), never stored again after this.
      return reply.status(201).send({
        id: created.id,
        token: created.token,
        territoryId: created.territoryId,
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
    const body = isRecord(request.body) ? request.body : {};
    const actor = typeof body.actor === 'string' ? body.actor.trim() : '';
    if (actor === '') {
      return reply.status(400).send({ error: 'invalid_request', message: 'actor must not be blank' });
    }
    await revokeShareToken(deps.pool, tokenId, actor);
    return reply.status(204).send();
  });
}
