/**
 * Translates a raw `pg` DatabaseError from a territory-revision insert into
 * one of the distinct domain errors in domain/errors.ts, by CHECK
 * constraint name (SQLSTATE 23514) or RAISE EXCEPTION message (the
 * containment/overlap triggers in db/migrations/0003_spatial_constraints.sql
 * do not use custom SQLSTATEs, so their messages are pinned here — a
 * migration change to either message must update this mapping).
 *
 * Constraint/message text is matched against exactly what A2 wrote; this
 * file is intentionally coupled to db/migrations and must be revisited if
 * that schema changes.
 */

import { DatabaseError } from 'pg';

import {
  ActiveAssignmentConflictError,
  BoundaryReferenceMissingError,
  InvalidGeometryError,
  OutOfBoundsError,
  UnauthorizedOverlapError,
  ValidationError,
  ZeroAreaGeometryError,
  type DomainError
} from '../domain/errors.js';

const ZERO_AREA_CONSTRAINTS = new Set([
  'territory_revisions_geom_not_empty',
  'territory_revisions_geom_has_area'
]);
const INVALID_GEOMETRY_CONSTRAINTS = new Set(['territory_revisions_geom_valid']);

/**
 * Maps a caught error to a typed domain error when it matches a known
 * PostGIS constraint or trigger message. Returns `undefined` — never
 * throws — for anything unrecognized, so the caller can decide whether to
 * rethrow the original error rather than mask an unexpected failure as one
 * of the four known causes.
 */
export function mapTerritoryGeometryError(error: unknown): DomainError | undefined {
  if (!(error instanceof DatabaseError)) {
    return undefined;
  }

  // SQLSTATE 23514 = check_violation.
  if (error.code === '23514' && error.constraint) {
    if (INVALID_GEOMETRY_CONSTRAINTS.has(error.constraint)) {
      return new InvalidGeometryError(`geometry is not a valid, simple polygon (${error.constraint})`);
    }
    if (ZERO_AREA_CONSTRAINTS.has(error.constraint)) {
      return new ZeroAreaGeometryError(`geometry has zero or negligible area (${error.constraint})`);
    }
  }

  // The containment/overlap triggers RAISE EXCEPTION without a custom
  // SQLSTATE, so PostgreSQL reports P0001 (raise_exception) for all three —
  // distinguish by message text, pinned to db/migrations/0003.
  if (error.code === 'P0001') {
    if (error.message.includes('municipal boundary reference not loaded')) {
      return new BoundaryReferenceMissingError(
        'the Bello municipal boundary reference is not loaded; run the AMVA seed before creating territory revisions'
      );
    }
    if (error.message.includes('is not contained by the Bello municipal boundary')) {
      return new OutOfBoundsError('geometry is not contained by the Bello municipal boundary');
    }
    if (error.message.includes('overlaps active territory') && error.message.includes('without an authorized exception')) {
      return new UnauthorizedOverlapError(error.message);
    }
  }

  return undefined;
}

/**
 * Runs `mapTerritoryGeometryError` and rethrows the mapped domain error when
 * found; otherwise rethrows the original error unchanged. Never swallows an
 * unrecognized failure.
 */
export function rethrowAsTerritoryGeometryError(error: unknown): never {
  const mapped = mapTerritoryGeometryError(error);
  if (mapped) {
    throw mapped;
  }
  throw error;
}

/**
 * Maps a raw `pg` DatabaseError from an assignments write into a typed
 * domain error, by constraint name or trigger message — same discipline as
 * mapTerritoryGeometryError, coupled to db/migrations/0002_core_schema.sql.
 */
export function mapAssignmentError(error: unknown): DomainError | undefined {
  if (!(error instanceof DatabaseError)) {
    return undefined;
  }

  // SQLSTATE 23505 = unique_violation. The partial UNIQUE index enforces at
  // most one ACTIVE assignment per territory; this fires both for a losing
  // concurrent assign() and for a reopen() that would create a second
  // active assignment for a territory another one already covers.
  if (error.code === '23505' && error.constraint === 'assignments_one_active_per_territory') {
    return new ActiveAssignmentConflictError(
      'this territory already has an active assignment; return or complete it first'
    );
  }

  // Defense-in-depth confirmation of the DB trigger backing the app-level
  // check in domain/assignments.ts — reached only if that check is ever
  // bypassed or buggy, never in the normal path.
  if (error.code === 'P0001' && error.message.includes('requires a reopen_reason')) {
    return new ValidationError('reopening an assignment requires a non-blank reason');
  }

  return undefined;
}

export function rethrowAsAssignmentError(error: unknown): never {
  const mapped = mapAssignmentError(error);
  if (mapped) {
    throw mapped;
  }
  throw error;
}

const PROGRESS_GEOMETRY_CONSTRAINTS: Record<string, string> = {
  progress_entries_pause_point_valid: 'pause point',
  progress_entries_route_valid: 'route',
  progress_entries_remaining_area_valid: 'remaining-area geometry'
};

/**
 * Maps a raw `pg` DatabaseError from a progress-entry insert into
 * InvalidGeometryError. Scope note: unlike territory geometry (slice 1's
 * four distinct causes), these three optional fields share ONE domain error
 * type — the brief's "distinct error per cause" requirement was scoped to
 * territory revisions specifically — but the MESSAGE still names exactly
 * which field failed, via the constraint name.
 */
export function mapProgressEntryError(error: unknown): DomainError | undefined {
  if (!(error instanceof DatabaseError)) {
    return undefined;
  }
  if (error.code === '23514' && error.constraint && error.constraint in PROGRESS_GEOMETRY_CONSTRAINTS) {
    const field = PROGRESS_GEOMETRY_CONSTRAINTS[error.constraint];
    return new InvalidGeometryError(`${field} is not a valid geometry (${error.constraint})`);
  }
  return undefined;
}

export function rethrowAsProgressEntryError(error: unknown): never {
  const mapped = mapProgressEntryError(error);
  if (mapped) {
    throw mapped;
  }
  throw error;
}
