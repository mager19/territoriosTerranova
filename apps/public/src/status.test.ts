import { describe, expect, it } from 'vitest';
import type { Polygon } from '@territorios/geo';

import {
  describeState,
  ERROR_MESSAGE,
  LOADING_MESSAGE,
  RECORDED_COVERAGE_MESSAGE,
  UNAVAILABLE_MESSAGE,
  UNKNOWN_COVERAGE_MESSAGE
} from './status.js';

const BOUNDARY: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-75.574, 6.357],
      [-75.572, 6.357],
      [-75.572, 6.359],
      [-75.574, 6.359],
      [-75.574, 6.357]
    ]
  ]
};

describe('describeState', () => {
  it('shows a loading message before the fetch resolves', () => {
    expect(describeState({ status: 'loading' }).body).toBe(LOADING_MESSAGE);
  });

  it('shows the same neutral message for an unavailable (revoked/expired/nonexistent) token', () => {
    expect(describeState({ status: 'unavailable' }).body).toBe(UNAVAILABLE_MESSAGE);
  });

  it('shows a distinct, non-alarming message for a network/server error', () => {
    expect(describeState({ status: 'error' }).body).toBe(ERROR_MESSAGE);
  });

  it('renders "unknown" coverage text when no progress has been recorded — never an inferred amount', () => {
    const state = describeState({
      status: 'ok',
      view: { territoryName: 'T-01', boundary: BOUNDARY, remainingArea: null, remainingAreaStatus: 'unknown' }
    });
    expect(state.body).toBe(UNKNOWN_COVERAGE_MESSAGE);
  });

  it('renders recorded coverage text when a remaining area was captured', () => {
    const state = describeState({
      status: 'ok',
      view: { territoryName: 'T-01', boundary: BOUNDARY, remainingArea: BOUNDARY, remainingAreaStatus: 'recorded' }
    });
    expect(state.body).toBe(RECORDED_COVERAGE_MESSAGE);
  });

  it('uses the territory name as the heading only for a resolved territory', () => {
    const state = describeState({
      status: 'ok',
      view: { territoryName: 'Navarra Norte', boundary: BOUNDARY, remainingArea: null, remainingAreaStatus: 'unknown' }
    });
    expect(state.heading).toBe('Navarra Norte');
  });
});
