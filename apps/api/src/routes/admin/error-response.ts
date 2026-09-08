/**
 * Shared HTTP mapping for admin route domain errors. Every DomainError
 * carries a distinct `code` (AGENTS.md: never a generic 400); this is the
 * one place that decides status codes, kept exhaustive over ALL of them
 * (territory geometry AND assignment lifecycle) so adding a new domain
 * error that no route maps is a compile error here, not a silent 500 at
 * runtime.
 */

import type { FastifyReply } from 'fastify';

import { isDomainError, type DomainError } from '../../domain/errors.js';

/**
 * Status choice: 400 for a problem with the request's own input
 * (invalid/zero-area geometry, out of bounds, blank fields), 404 for a
 * missing territory/assignment, 409 for a real conflict with existing
 * state (unauthorized overlap, an assignment that is already
 * active/inactive, or losing a race for the one-active-assignment slot),
 * 503 for an operational precondition this request cannot fix (the
 * boundary reference itself is missing).
 */
export function statusForDomainError(error: DomainError): number {
  switch (error.code) {
    case 'invalid_geometry':
    case 'zero_area_geometry':
    case 'out_of_bounds':
    case 'invalid_request':
      return 400;
    case 'territory_not_found':
    case 'assignment_not_found':
      return 404;
    case 'unauthorized_overlap':
    case 'assignment_not_active':
    case 'active_assignment_conflict':
      return 409;
    case 'boundary_reference_missing':
      return 503;
  }
}

/**
 * Sends the correct status + {error: code, message} body for a caught
 * domain error, or returns false so the caller rethrows anything else
 * (never swallow an unrecognized failure into a fabricated response).
 */
export function trySendDomainError(reply: FastifyReply, error: unknown): boolean {
  if (!isDomainError(error)) {
    return false;
  }
  reply.status(statusForDomainError(error)).send({ error: error.code, message: error.message });
  return true;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
