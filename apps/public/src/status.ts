import { isEmptyPolygon, type PublicTerritoryResult } from './public-api.js';

export const UNAVAILABLE_MESSAGE = 'Este enlace ya no está disponible.';
export const ERROR_MESSAGE = 'No pudimos cargar este territorio. Revisa tu conexión e inténtalo de nuevo.';
export const LOADING_MESSAGE = 'Cargando territorio…';
export const COMPLETE_COVERAGE_MESSAGE = 'Territorio completo: ya se cubrió toda el área en este ciclo.';
export const ROUTE_COVERAGE_MESSAGE = 'Avance registrado: lo recorrido está marcado en el mapa.';
export const RECORDED_COVERAGE_MESSAGE = 'Avance parcial registrado: lo hecho y lo pendiente están marcados en el mapa.';
export const UNKNOWN_COVERAGE_MESSAGE = 'Área pendiente: desconocida. Todavía no se ha registrado avance en este territorio.';

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
      return { heading: 'Territorios', body: LOADING_MESSAGE };
    case 'unavailable':
      return { heading: 'Enlace no disponible', body: UNAVAILABLE_MESSAGE };
    case 'error':
      return { heading: 'Problema de conexión', body: ERROR_MESSAGE };
    case 'ok': {
      // An explicit empty remaining area is the server's "nothing left"
      // marker — the territory is complete, never "partial". Otherwise
      // route and remainingArea are independent, optionally-recorded
      // fields (AGENTS.md: coverage is never inferred) — check route
      // first since it is the common manzana/perimeter case; fall back
      // to the area-based message when only remainingArea was recorded.
      let body: string;
      if (state.view.remainingAreaStatus === 'recorded' && isEmptyPolygon(state.view.remainingArea)) {
        body = COMPLETE_COVERAGE_MESSAGE;
      } else if (state.view.route !== null) {
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
