/**
 * The one call this app ever makes: A4's public, read-only endpoint. Never
 * an admin URL — the A6 brief forbids it outright, even for development
 * convenience (AGENTS.md; A6-public-web.md "Never fetch from an admin
 * endpoint").
 */

import type { LineString, MultiPolygon, Point, Polygon } from '@territorios/geo';
import { isLineString, isMultiPolygon, isPoint, isPolygon } from '@territorios/geo';

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000';

export interface PublicTerritoryView {
  readonly territoryName: string;
  readonly boundary: Polygon;
  /**
   * Server-derived since coverage sessions (db/migrations/0007): subtracting
   * a covered area can split it into a MultiPolygon, and a fully covered
   * cycle is an explicit EMPTY polygon (`coordinates: []`, "nothing left")
   * — distinct from null, which means unknown.
   */
  readonly remainingArea: Polygon | MultiPolygon | null;
  readonly remainingAreaStatus: 'recorded' | 'unknown';
  /**
   * The current cycle's latest recorded route — a deliberate exception to
   * the "exclude everything but the territory/coverage shape" rule
   * (2026-09-08 product decision, AGENTS.md "Privacy rules"): volunteers
   * need to see the coverage line to resume the next day.
   */
  readonly route: LineString | null;
  /**
   * Where the work stopped: the current cycle's latest recorded pause
   * point (2026-09-26 product decision, AGENTS.md "Privacy rules").
   */
  readonly pausePoint: Point | null;
  /**
   * The area already done: every covered area of the current cycle merged
   * into ONE shape by the server (2026-09-26 product decision). Tolerates
   * an explicit empty polygon the same way remainingArea does.
   */
  readonly coveredArea: Polygon | MultiPolygon | null;
}

export type PublicTerritoryResult =
  | { readonly status: 'ok'; readonly view: PublicTerritoryView }
  | { readonly status: 'unavailable' }
  | { readonly status: 'error' };

/** An explicit empty polygon — the API's "nothing left" marker, never a missing value. */
export function isEmptyPolygon(value: unknown): value is Polygon {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'Polygon' &&
    Array.isArray((value as { coordinates?: unknown }).coordinates) &&
    (value as { coordinates: unknown[] }).coordinates.length === 0
  );
}

/** Polygon, MultiPolygon, or the explicit empty polygon — the shape of remainingArea and coveredArea. */
function isAreaGeometry(value: unknown): value is Polygon | MultiPolygon {
  return isPolygon(value) || isMultiPolygon(value) || isEmptyPolygon(value);
}

/**
 * Reads ONLY the seven allowlisted fields off the raw response body. This
 * is the actual enforcement point for the A6 hard constraint "do not
 * render assignee identity, notes, timestamps, history ... even if the API
 * mistakenly returns them" — any other field on the raw JSON is never
 * touched, structurally, no matter what the server sends. `route`
 * (2026-09-08) and `pausePoint` + `coveredArea` (2026-09-26) are the
 * deliberate inclusions beyond the original four (A4's public contract,
 * AGENTS.md "Privacy rules"). See public-api.test.ts for the test that
 * proves an unexpected field never reaches the returned view.
 *
 * `pausePoint` and `coveredArea` are read as null when absent, so an API
 * deployed before 2026-09-26 still renders instead of failing outright.
 */
function parseView(raw: unknown): PublicTerritoryView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const territoryName = record.territoryName;
  const boundary = record.boundary;
  const remainingArea = record.remainingArea;
  const remainingAreaStatus = record.remainingAreaStatus;
  const route = record.route;
  const pausePoint = record.pausePoint ?? null;
  const coveredArea = record.coveredArea ?? null;

  if (typeof territoryName !== 'string' || territoryName.trim() === '') return null;
  if (!isPolygon(boundary)) return null;
  if (remainingArea !== null && !isAreaGeometry(remainingArea)) return null;
  if (remainingAreaStatus !== 'recorded' && remainingAreaStatus !== 'unknown') return null;
  if (route !== null && !isLineString(route)) return null;
  if (pausePoint !== null && !isPoint(pausePoint)) return null;
  if (coveredArea !== null && !isAreaGeometry(coveredArea)) return null;

  return { territoryName, boundary, remainingArea, remainingAreaStatus, route, pausePoint, coveredArea };
}

/**
 * Every unauthorized reason (revoked, expired, wrong scope, genuinely
 * nonexistent) is already collapsed into one 404 by A4 — this function
 * only adds a second, unrelated branch: "the network/server didn't
 * answer", which is not a validity signal and is fine to distinguish.
 */
export async function fetchPublicTerritory(
  token: string,
  fetchImpl: typeof fetch = fetch,
  baseUrl: string = API_BASE_URL
): Promise<PublicTerritoryResult> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/public/territories/${encodeURIComponent(token)}`);
  } catch {
    return { status: 'error' };
  }

  if (response.status === 404) {
    return { status: 'unavailable' };
  }
  if (!response.ok) {
    return { status: 'error' };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return { status: 'error' };
  }

  const view = parseView(raw);
  if (view === null) {
    return { status: 'error' };
  }
  return { status: 'ok', view };
}
