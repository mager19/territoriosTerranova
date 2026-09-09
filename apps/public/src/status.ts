import type { PublicTerritoryResult } from './public-api.js';

export const UNAVAILABLE_MESSAGE = 'This link is no longer available.';
export const ERROR_MESSAGE = "We couldn't load this territory right now. Check your connection and try again.";
export const LOADING_MESSAGE = 'Loading territory…';
export const ROUTE_COVERAGE_MESSAGE = 'Progress recorded — the covered stretch is marked on the map.';
export const RECORDED_COVERAGE_MESSAGE = 'Partial coverage recorded — the remaining area is marked on the map.';
export const UNKNOWN_COVERAGE_MESSAGE = 'Remaining coverage: unknown. No progress has been recorded for this assignment yet.';

export type ViewState = PublicTerritoryResult | { readonly status: 'loading' };

export interface RenderedStatus {
  readonly heading: string;
  readonly body: string;
}

/**
 * Every non-ok outcome — missing token, revoked, expired, or a genuinely
 * unknown token — collapses to the exact same neutral copy, mirroring
 * A4's own collapsed 404 (A6 brief: "Revoked, expired, and invalid tokens
 * all render the same neutral message"). There is no branch here that
 * could leak which reason applied.
 */
export function describeState(state: ViewState): RenderedStatus {
  switch (state.status) {
    case 'loading':
      return { heading: 'Territory Management', body: LOADING_MESSAGE };
    case 'unavailable':
      return { heading: 'Link unavailable', body: UNAVAILABLE_MESSAGE };
    case 'error':
      return { heading: 'Connection problem', body: ERROR_MESSAGE };
    case 'ok': {
      // route and remainingArea are independent, optionally-recorded
      // fields (AGENTS.md: coverage is never inferred) — check route
      // first since it is the common manzana/perimeter case; fall back
      // to the area-based message when only remainingArea was recorded.
      let body: string;
      if (state.view.route !== null) {
        body = ROUTE_COVERAGE_MESSAGE;
      } else if (state.view.remainingAreaStatus === 'recorded') {
        body = RECORDED_COVERAGE_MESSAGE;
      } else {
        body = UNKNOWN_COVERAGE_MESSAGE;
      }
      return { heading: state.view.territoryName, body };
    }
  }
}
