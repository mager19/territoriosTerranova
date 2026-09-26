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

/**
 * The first coverage session of a cycle has no remaining area to subtract
 * from, and the administrator has not explicitly confirmed a baseline
 * (AGENTS.md: remaining coverage is never inferred from the territory
 * polygon). Distinct code so the admin UI can turn it into an in-page
 * confirmation prompt instead of a generic error.
 */
export class BaselineRequiredError extends Error {
  readonly code = 'baseline_required' as const;
  constructor() {
    super(
      "the current cycle has no recorded remaining area; confirm baseline 'whole_territory' to start this cycle from the whole territory"
    );
    this.name = 'BaselineRequiredError';
  }
}

/**
 * The covered area does not overlap what is still pending in the current
 * cycle (including a cycle whose remaining area is already empty). Distinct
 * code so the admin UI can say exactly that.
 */
export class CoveredAreaNotRemainingError extends Error {
  readonly code = 'covered_area_not_remaining' as const;
  constructor(message: string) {
    super(message);
    this.name = 'CoveredAreaNotRemainingError';
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
  | DuplicateTerritoryNumberError
  | BaselineRequiredError
  | CoveredAreaNotRemainingError;

export function isDomainError(error: unknown): error is DomainError {
  return (
    error instanceof InvalidGeometryError ||
    error instanceof ZeroAreaGeometryError ||
    error instanceof OutOfBoundsError ||
    error instanceof BoundaryReferenceMissingError ||
    error instanceof UnauthorizedOverlapError ||
    error instanceof TerritoryNotFoundError ||
    error instanceof ValidationError ||
    error instanceof DuplicateTerritoryNumberError ||
    error instanceof BaselineRequiredError ||
    error instanceof CoveredAreaNotRemainingError
  );
}
