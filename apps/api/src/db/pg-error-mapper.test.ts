import { describe, expect, it } from 'vitest';
import { DatabaseError } from 'pg';

import {
  mapProgressEntryError,
  mapTerritoryGeometryError,
  rethrowAsProgressEntryError,
  rethrowAsTerritoryGeometryError
} from './pg-error-mapper.js';
import {
  BoundaryReferenceMissingError,
  InvalidGeometryError,
  OutOfBoundsError,
  UnauthorizedOverlapError,
  ZeroAreaGeometryError
} from '../domain/errors.js';

function checkViolation(constraint: string): DatabaseError {
  const error = new DatabaseError('check violation', 0, 'error');
  error.code = '23514';
  error.constraint = constraint;
  return error;
}

function raiseException(message: string): DatabaseError {
  const error = new DatabaseError(message, 0, 'error');
  error.code = 'P0001';
  return error;
}

describe('mapTerritoryGeometryError', () => {
  it('maps territory_revisions_geom_valid to InvalidGeometryError', () => {
    const mapped = mapTerritoryGeometryError(checkViolation('territory_revisions_geom_valid'));
    expect(mapped).toBeInstanceOf(InvalidGeometryError);
  });

  it('maps territory_revisions_geom_not_empty to ZeroAreaGeometryError', () => {
    const mapped = mapTerritoryGeometryError(checkViolation('territory_revisions_geom_not_empty'));
    expect(mapped).toBeInstanceOf(ZeroAreaGeometryError);
  });

  it('maps territory_revisions_geom_has_area to ZeroAreaGeometryError', () => {
    const mapped = mapTerritoryGeometryError(checkViolation('territory_revisions_geom_has_area'));
    expect(mapped).toBeInstanceOf(ZeroAreaGeometryError);
  });

  it('maps the containment trigger message to OutOfBoundsError', () => {
    const mapped = mapTerritoryGeometryError(
      raiseException('territory revision 7 is not contained by the Bello municipal boundary')
    );
    expect(mapped).toBeInstanceOf(OutOfBoundsError);
  });

  it('maps the missing-boundary-reference message to BoundaryReferenceMissingError, not OutOfBoundsError', () => {
    const mapped = mapTerritoryGeometryError(
      raiseException('municipal boundary reference not loaded; run the AMVA seed before creating territory revisions')
    );
    expect(mapped).toBeInstanceOf(BoundaryReferenceMissingError);
  });

  it('maps the overlap trigger message to UnauthorizedOverlapError', () => {
    const mapped = mapTerritoryGeometryError(
      raiseException('territory revision 9 overlaps active territory 3 (Niquía) without an authorized exception')
    );
    expect(mapped).toBeInstanceOf(UnauthorizedOverlapError);
  });

  it('returns undefined for an unrecognized constraint', () => {
    expect(mapTerritoryGeometryError(checkViolation('some_other_constraint'))).toBeUndefined();
  });

  it('returns undefined for a non-DatabaseError', () => {
    expect(mapTerritoryGeometryError(new Error('plain error'))).toBeUndefined();
    expect(mapTerritoryGeometryError('not even an error')).toBeUndefined();
  });
});

describe('rethrowAsTerritoryGeometryError', () => {
  it('throws the mapped domain error when recognized', () => {
    expect(() => rethrowAsTerritoryGeometryError(checkViolation('territory_revisions_geom_valid'))).toThrow(
      InvalidGeometryError
    );
  });

  it('rethrows the original error unchanged when unrecognized', () => {
    const original = new Error('unrelated failure');
    expect(() => rethrowAsTerritoryGeometryError(original)).toThrow(original);
  });
});

describe('mapProgressEntryError', () => {
  it.each([
    ['progress_entries_pause_point_valid', /pause point/],
    ['progress_entries_route_valid', /route/],
    ['progress_entries_remaining_area_valid', /remaining-area/]
  ])('maps %s to InvalidGeometryError naming the field in the message', (constraint, expectedPattern) => {
    const mapped = mapProgressEntryError(checkViolation(constraint));
    expect(mapped).toBeInstanceOf(InvalidGeometryError);
    expect(mapped?.message).toMatch(expectedPattern);
  });

  it('returns undefined for an unrecognized constraint', () => {
    expect(mapProgressEntryError(checkViolation('some_other_constraint'))).toBeUndefined();
  });

  it('returns undefined for a non-DatabaseError', () => {
    expect(mapProgressEntryError(new Error('plain error'))).toBeUndefined();
  });
});

describe('rethrowAsProgressEntryError', () => {
  it('throws the mapped domain error when recognized', () => {
    expect(() => rethrowAsProgressEntryError(checkViolation('progress_entries_route_valid'))).toThrow(
      InvalidGeometryError
    );
  });

  it('rethrows the original error unchanged when unrecognized', () => {
    const original = new Error('unrelated failure');
    expect(() => rethrowAsProgressEntryError(original)).toThrow(original);
  });
});
