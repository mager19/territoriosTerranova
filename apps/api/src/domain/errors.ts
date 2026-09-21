/**
 * Distinct, typed domain errors for territory geometry rejection (AGENTS.md:
 * "never repair geometry silently") and other domain-invariant violations.
 *
 * Each carries a machine-readable `code` so route handlers map it to a
 * specific HTTP response instead of a generic 400 — the A3 brief's DoD
 * requires "a distinct error per cause, never a generic 400" across exactly
 * four causes: invalid geometry, zero-area geometry, out-of-bounds, and
 * unauthorized overlap. `BoundaryReferenceMissingError` is a fifth, distinct
 * *operational* failure (the system cannot verify containment at all) and is
 * deliberately never folded into `out_of_bounds` — that would blame the
 * administrator's geometry for a missing AMVA seed.
 */

export class InvalidGeometryError extends Error {
  readonly code = 'invalid_geometry' as const;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGeometryError';
  }
}

export class ZeroAreaGeometryError extends Error {
  readonly code = 'zero_area_geometry' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ZeroAreaGeometryError';
  }
}

export class OutOfBoundsError extends Error {
  readonly code = 'out_of_bounds' as const;
  constructor(message: string) {
    super(message);
    this.name = 'OutOfBoundsError';
  }
}

export class BoundaryReferenceMissingError extends Error {
  readonly code = 'boundary_reference_missing' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BoundaryReferenceMissingError';
  }
}

export class UnauthorizedOverlapError extends Error {
  readonly code = 'unauthorized_overlap' as const;
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedOverlapError';
  }
}

export class TerritoryNotFoundError extends Error {
  readonly code = 'territory_not_found' as const;
  constructor(territoryId: number) {
    super(`territory ${territoryId} does not exist`);
    this.name = 'TerritoryNotFoundError';
  }
}

/** Non-geometry input validation (blank required fields, etc.) — always a 400. */
export class ValidationError extends Error {
  readonly code = 'invalid_request' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class DuplicateTerritoryNumberError extends Error {
  readonly code = 'duplicate_territory_number' as const;
  constructor() {
    super('territory number is already in use');
    this.name = 'DuplicateTerritoryNumberError';
  }
}

/** Every typed domain error a caller should catch and map to a distinct response. */
export type DomainError =
  | InvalidGeometryError
  | ZeroAreaGeometryError
  | OutOfBoundsError
  | BoundaryReferenceMissingError
  | UnauthorizedOverlapError
  | TerritoryNotFoundError
  | ValidationError
  | DuplicateTerritoryNumberError;

export function isDomainError(error: unknown): error is DomainError {
  return (
    error instanceof InvalidGeometryError ||
    error instanceof ZeroAreaGeometryError ||
    error instanceof OutOfBoundsError ||
    error instanceof BoundaryReferenceMissingError ||
    error instanceof UnauthorizedOverlapError ||
    error instanceof TerritoryNotFoundError ||
    error instanceof ValidationError ||
    error instanceof DuplicateTerritoryNumberError
  );
}
