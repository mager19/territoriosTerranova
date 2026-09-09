/**
 * Thin fetch wrapper over A3's admin API. A5 brief DoD: "Server validation
 * errors are surfaced with their specific cause — never a generic
 * 'something went wrong'." ApiError always carries the server's own
 * `error` code and `message`; callers render THAT, never a fabricated
 * string.
 */

import type { LineString, MultiPolygon, Point, Polygon } from '@territorios/geo';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000';
/** apps/public's dev origin — used only to build a share link's display text (token.ts reads the fragment client-side, this app never fetches it). */
export const PUBLIC_APP_BASE_URL = import.meta.env.VITE_PUBLIC_APP_BASE_URL ?? 'http://127.0.0.1:5174';

/**
 * Placeholder actor for every admin write (revision author, share
 * created-by/revoked-by) until there is a real per-user profile/auth
 * system (2026-09-08 product decision: stop asking for a name on every
 * single action — one admin/volunteer group, no individual accountability
 * yet). The server still requires a non-blank string in each of these
 * fields, so this is what satisfies that until profiles exist.
 */
export const DEFAULT_ACTOR = 'admin';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface TerritoryRevision {
  readonly id: number;
  readonly territoryId: number;
  readonly revisionNumber: number;
  readonly geometry: Polygon;
  readonly author: string;
  readonly createdAt: string;
}

export interface Territory {
  readonly id: number;
  readonly name: string;
  readonly status: 'active' | 'archived';
  readonly createdAt: string;
  readonly currentRevisionNumber: number;
}

export interface TerritoryWithRevisions extends Omit<Territory, 'currentRevisionNumber'> {
  readonly revisions: readonly TerritoryRevision[];
}

export interface AuditEvent {
  readonly id: number;
  readonly entityType: string;
  readonly entityId: number;
  readonly action: string;
  readonly actor: string;
  readonly reason: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

export interface ProgressEntry {
  readonly id: number;
  readonly territoryId: number;
  readonly recordedBy: string;
  readonly recordedAt: string;
  readonly note: string | null;
  readonly pausePoint: Point | null;
  readonly route: LineString | null;
  readonly remainingArea: Polygon | null;
  /** Explicit, never-inferred: 'unknown' means not recorded, never "fully covered" (AGENTS.md). */
  readonly remainingAreaStatus: 'recorded' | 'unknown';
}

/**
 * A share token scopes to a whole territory, not a per-person claim
 * (2026-09-08: territories are shared to a group of volunteers, not
 * assigned to one named person). `token` is the plaintext link secret,
 * present ONLY in the response to createShareToken — never returned or
 * stored again after that.
 */
export interface ShareToken {
  readonly id: number;
  readonly token: string;
  readonly territoryId: number;
  readonly createdAt: string;
  readonly expiresAt: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers }
    });
  } catch {
    // Distinguishes "the server answered with a rejection" (ApiError,
    // handled below) from "we could not reach the server at all" — a
    // different failure the UI must not describe the same way.
    throw new ApiError(0, 'network_error', `could not reach the API at ${API_BASE_URL}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const errorCode = isRecord(body) && typeof body.error === 'string' ? body.error : 'unknown_error';
    const message = isRecord(body) && typeof body.message === 'string' ? body.message : response.statusText;
    throw new ApiError(response.status, errorCode, message);
  }

  return body as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function listTerritories(): Promise<{ territories: readonly Territory[] }> {
  return request('/admin/territories');
}

export function getTerritory(id: number): Promise<TerritoryWithRevisions> {
  return request(`/admin/territories/${id}`);
}

export function createTerritory(input: {
  name: string;
  geometry: Polygon;
  author: string;
}): Promise<TerritoryWithRevisions> {
  return request('/admin/territories', { method: 'POST', body: JSON.stringify(input) });
}

export function submitRevision(
  territoryId: number,
  input: { geometry: Polygon; author: string }
): Promise<TerritoryRevision> {
  return request(`/admin/territories/${territoryId}/revisions`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function getTerritoryAudit(territoryId: number): Promise<{ territoryId: number; events: readonly AuditEvent[] }> {
  return request(`/admin/territories/${territoryId}/audit`);
}

export function listProgress(territoryId: number): Promise<{ entries: readonly ProgressEntry[] }> {
  return request(`/admin/territories/${territoryId}/progress`);
}

export function recordProgress(
  territoryId: number,
  input: { recordedBy: string; note?: string; route?: LineString }
): Promise<ProgressEntry> {
  return request(`/admin/territories/${territoryId}/progress`, { method: 'POST', body: JSON.stringify(input) });
}

export function createShareToken(
  territoryId: number,
  input: { createdBy: string; expiresAt?: string }
): Promise<ShareToken> {
  return request(`/admin/territories/${territoryId}/share-tokens`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function revokeShareToken(tokenId: number, actor: string): Promise<void> {
  return request(`/admin/share-tokens/${tokenId}/revoke`, { method: 'POST', body: JSON.stringify({ actor }) });
}

/** An AMVA barrio (POT 2009 vintage) — admin-only drafting reference, never shown on the public view (AGENTS.md). */
export interface ReferenceBarrio {
  readonly id: number;
  readonly name: string;
  readonly geometry: MultiPolygon;
  readonly extensionKm2: number | null;
  readonly population: number | null;
}

export function searchReferenceBarrios(name: string): Promise<{ barrios: readonly ReferenceBarrio[] }> {
  return request(`/admin/reference/barrios?name=${encodeURIComponent(name)}`);
}

/**
 * The server's own error messages are English prose meant for a developer
 * reading logs (AGENTS.md / A3 brief: technical artifacts default to
 * English) — not for the Spanish-speaking admins/volunteers who actually
 * use this UI. `error.code` is the stable, typed part of the contract
 * (statusForDomainError's exhaustive switch, apps/api/src/routes/admin/
 * error-response.ts), so it is what gets translated here; an unrecognized
 * code (should not happen — the codes are a closed, tested set) falls back
 * to the raw server message rather than showing nothing.
 */
const ERROR_MESSAGES_ES: Record<string, string> = {
  invalid_geometry: 'La geometría no es válida.',
  zero_area_geometry: 'La geometría no tiene área real.',
  out_of_bounds: 'La forma queda fuera del límite municipal de Bello.',
  invalid_request: 'Faltan datos o el formato no es válido.',
  territory_not_found: 'Ese territorio no existe.',
  unauthorized_overlap: 'Esta forma se superpone con otro territorio activo.',
  boundary_reference_missing: 'Falta cargar el límite municipal de referencia.',
  network_error: 'No se pudo conectar con el servidor.',
  unexpected_error: 'Ocurrió un error inesperado; no se guardó nada.'
};

export function describeApiError(error: ApiError): string {
  return ERROR_MESSAGES_ES[error.code] ?? error.message;
}
