/**
 * The one call this app ever makes: A4's public, read-only endpoint. Never
 * an admin URL — the A6 brief forbids it outright, even for development
 * convenience (AGENTS.md; A6-public-web.md "Never fetch from an admin
 * endpoint").
 */

import type { Polygon } from '@territorios/geo';
import { isPolygon } from '@territorios/geo';

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000';

export interface PublicTerritoryView {
  readonly territoryName: string;
  readonly boundary: Polygon;
  readonly remainingArea: Polygon | null;
  readonly remainingAreaStatus: 'recorded' | 'unknown';
}

export type PublicTerritoryResult =
  | { readonly status: 'ok'; readonly view: PublicTerritoryView }
  | { readonly status: 'unavailable' }
  | { readonly status: 'error' };

/**
 * Reads ONLY the four allowlisted fields off the raw response body. This
 * is the actual enforcement point for the A6 hard constraint "do not
 * render assignee identity, notes, timestamps, ... even if the API
 * mistakenly returns them" — any other field on the raw JSON is never
 * touched, structurally, no matter what the server sends. See
 * public-api.test.ts for the test that proves an unexpected field never
 * reaches the returned view.
 */
function parseView(raw: unknown): PublicTerritoryView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const territoryName = record.territoryName;
  const boundary = record.boundary;
  const remainingArea = record.remainingArea;
  const remainingAreaStatus = record.remainingAreaStatus;

  if (typeof territoryName !== 'string' || territoryName.trim() === '') return null;
  if (!isPolygon(boundary)) return null;
  if (remainingArea !== null && !isPolygon(remainingArea)) return null;
  if (remainingAreaStatus !== 'recorded' && remainingAreaStatus !== 'unknown') return null;

  return { territoryName, boundary, remainingArea, remainingAreaStatus };
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
