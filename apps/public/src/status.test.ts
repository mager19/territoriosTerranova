import { describe, expect, it } from 'vitest';
import type { LineString, Polygon } from '@territorios/geo';

import {
  COMPLETE_COVERAGE_MESSAGE,
  describeState,
  ERROR_MESSAGE,
  LOADING_MESSAGE,
  RECORDED_COVERAGE_MESSAGE,
  ROUTE_COVERAGE_MESSAGE,
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
      view: { territoryName: 'T-01', boundary: BOUNDARY, remainingArea: null, remainingAreaStatus: 'unknown', route: null, note: null, coveredArea: null }
    });
    expect(state.body).toBe(UNKNOWN_COVERAGE_MESSAGE);
  });

  it('renders recorded coverage text when a remaining area was captured', () => {
    const state = describeState({
      status: 'ok',
      view: { territoryName: 'T-01', boundary: BOUNDARY, remainingArea: BOUNDARY, remainingAreaStatus: 'recorded', route: null, note: null, coveredArea: null }
    });
    expect(state.body).toBe(RECORDED_COVERAGE_MESSAGE);
  });

  it('renders route coverage text when a route was captured, even without a remaining area', () => {
    const route: LineString = { type: 'LineString', coordinates: [[-75.574, 6.357], [-75.572, 6.359]] };
    const state = describeState({
      status: 'ok',
      view: { territoryName: 'T-01', boundary: BOUNDARY, remainingArea: null, remainingAreaStatus: 'unknown', route, note: null, coveredArea: null }
    });
    expect(state.body).toBe(ROUTE_COVERAGE_MESSAGE);
  });

  it('prefers the route message over the remaining-area message when both were recorded', () => {
    const route: LineString = { type: 'LineString', coordinates: [[-75.574, 6.357], [-75.572, 6.359]] };
    const state = describeState({
      status: 'ok',
      view: { territoryName: 'T-01', boundary: BOUNDARY, remainingArea: BOUNDARY, remainingAreaStatus: 'recorded', route, note: null, coveredArea: null }
    });
    expect(state.body).toBe(ROUTE_COVERAGE_MESSAGE);
  });

  it('says the territory is complete — never "partial" — when the remaining area is explicitly empty', () => {
    const route: LineString = { type: 'LineString', coordinates: [[-75.574, 6.357], [-75.572, 6.359]] };
    const state = describeState({
      status: 'ok',
      view: {
        territoryName: 'T-01',
        boundary: BOUNDARY,
        remainingArea: { type: 'Polygon', coordinates: [] },
        remainingAreaStatus: 'recorded',
        route,
        note: null,
        coveredArea: BOUNDARY
      }
    });
    expect(state.body).toBe(COMPLETE_COVERAGE_MESSAGE);
    expect(state.body).not.toBe(RECORDED_COVERAGE_MESSAGE);
  });

  it('uses the territory name as the heading only for a resolved territory', () => {
    const state = describeState({
      status: 'ok',
      view: { territoryName: 'Navarra Norte', boundary: BOUNDARY, remainingArea: null, remainingAreaStatus: 'unknown', route: null, note: null, coveredArea: null }
    });
    expect(state.heading).toBe('Navarra Norte');
  });
});
