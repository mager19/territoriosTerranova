/**
 * Thin fetch wrapper over A3's admin API. A5 brief DoD: "Server validation
 * errors are surfaced with their specific cause — never a generic
 * 'something went wrong'." ApiError always carries the server's own
 * `error` code and `message`; callers render THAT, never a fabricated
 * string.
 */

import type { LineString, MultiPolygon, Point, Polygon } from '@territorios/geo';

/**
 * Same-origin API prefix (docs/admin-auth.md): Vite's dev server proxies
 * /api/* to the API, and Vercel rewrites it in production, so the session
 * cookie is always first-party. Deliberately not configurable to another
 * origin — the session cookie would not travel there.
 */
export const API_BASE_URL = '/api';
/** apps/public's dev origin — used only to build a share link's display text (token.ts reads the fragment client-side, this app never fetches it). */
export const PUBLIC_APP_BASE_URL = import.meta.env.VITE_PUBLIC_APP_BASE_URL ?? 'http://127.0.0.1:5174';

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
  readonly number: string | null;
}

/** A territory as returned by the list endpoint: `Territory` plus the current revision's geometry for a static SVG thumbnail (null when it has no revisions). */
export interface TerritoryListItem extends Territory {
  readonly geometry: Polygon | null;
  readonly operationalState: OperationalState;
}

export interface TerritoryWithRevisions extends Omit<Territory, 'currentRevisionNumber'> {
  readonly revisions: readonly TerritoryRevision[];
}

/**
 * One recorded session. Since 2026-09-26 every new session carries the area
 * COVERED in it and the server derives the remaining area; entries from
 * before that have `coveredArea: null`.
 */
export interface ProgressEntry {
  readonly id: number;
  readonly territoryId: number;
  /** Operational cycle the session belongs to (null only for entries predating cycles). */
  readonly cycleNumber: number | null;
  readonly recordedBy: string;
  readonly recordedAt: string;
  readonly note: string | null;
  readonly pausePoint: Point | null;
  readonly route: LineString | null;
  readonly coveredArea: Polygon | MultiPolygon | null;
  /** 'whole_territory' when the administrator confirmed that baseline for the cycle's first session. */
  readonly baseline: CoverageBaseline | null;
  /** An empty polygon (`coordinates: []`) means nothing is left; null means unknown. */
  readonly remainingArea: Polygon | MultiPolygon | null;
  /** Explicit, never-inferred: 'unknown' means not recorded, never "fully covered" (AGENTS.md). */
  readonly remainingAreaStatus: 'recorded' | 'unknown';
}

export type CoverageBaseline = 'whole_territory';

export type OperationalState = 'no_record' | 'in_progress' | 'paused' | 'cycle_completed' | 'reopened';

/** Administrative work-cycle state only. This is never returned from public endpoints. */
export interface TerritoryOperationalStatus {
  readonly state: OperationalState;
  readonly cycleNumber: number | null;
  readonly effectiveCompletionDate: string | null;
  /** Latest remaining area of the current cycle; an empty polygon means nothing is left, null means unknown. */
  readonly remainingArea: Polygon | MultiPolygon | null;
  readonly remainingAreaStatus: 'recorded' | 'unknown';
  /** Approximate progress of the current cycle, 0–100; null means unknown. */
  readonly progressPercent: number | null;
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

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/**
 * Subscribes to "the API answered 401": the session is missing, expired, or
 * revoked, so the app must return to the login screen. Returns the
 * unsubscribe function.
 */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

interface RequestOptions {
  /** False for the auth calls themselves, where a 401 is an answer, not a lost session. */
  readonly notifyUnauthorized?: boolean;
}

async function request<T>(path: string, init?: RequestInit, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      // The admin_session cookie (httpOnly) is the only credential; it is
      // same-origin by construction (see API_BASE_URL).
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...init?.headers }
    });
  } catch {
    // Distinguishes "the server answered with a rejection" (ApiError,
    // handled below) from "we could not reach the server at all" — a
    // different failure the UI must not describe the same way.
    throw new ApiError(0, 'network_error', `could not reach the API at ${API_BASE_URL}`);
  }

  if (response.status === 401 && options.notifyUnauthorized !== false) {
    for (const listener of unauthorizedListeners) listener();
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

/** The signed-in administrator, or null when there is no valid session. */
export async function getMe(): Promise<{ email: string } | null> {
  try {
    return await request<{ email: string }>('/admin/me', undefined, { notifyUnauthorized: false });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** Rejects with ApiError 401 (wrong credentials) or 429 (too many attempts). */
export function login(email: string, password: string): Promise<{ email: string }> {
  return request(
    '/admin/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    { notifyUnauthorized: false }
  );
}

export function logout(): Promise<void> {
  return request('/admin/logout', { method: 'POST', body: JSON.stringify({}) }, { notifyUnauthorized: false });
}

export function listTerritories(): Promise<{ territories: readonly TerritoryListItem[] }> {
  return request('/admin/territories');
}

export function getTerritory(id: number): Promise<TerritoryWithRevisions> {
  return request(`/admin/territories/${id}`);
}

export function createTerritory(input: {
  name: string;
  geometry: Polygon;
  number?: string;
}): Promise<TerritoryWithRevisions> {
  return request('/admin/territories', { method: 'POST', body: JSON.stringify(input) });
}

export function submitRevision(
  territoryId: number,
  input: { geometry: Polygon }
): Promise<TerritoryRevision> {
  return request(`/admin/territories/${territoryId}/revisions`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function listProgress(territoryId: number): Promise<{ entries: readonly ProgressEntry[] }> {
  return request(`/admin/territories/${territoryId}/progress`);
}

/**
 * A new session: the covered area is required; the remaining area is always
 * computed by the server, and the recorder is the signed-in administrator.
 */
export interface RecordSessionInput {
  readonly note?: string;
  readonly coveredArea: Polygon;
  readonly baseline?: CoverageBaseline;
  readonly pausePoint?: Point;
  readonly route?: LineString;
}

export function recordProgress(
  territoryId: number,
  input: RecordSessionInput
): Promise<ProgressEntry> {
  return request(`/admin/territories/${territoryId}/progress`, { method: 'POST', body: JSON.stringify(input) });
}

export function getTerritoryOperationalStatus(territoryId: number): Promise<TerritoryOperationalStatus> {
  return request(`/admin/territories/${territoryId}/operational-state`);
}

/**
 * One operational work cycle (2026-10-03: a territory is explicitly opened,
 * worked, then closed; each opening starts a new cycle). Newest first.
 */
export interface TerritoryCycle {
  readonly cycleNumber: number;
  /** ISO timestamp of the opening. */
  readonly openedAt: string;
  /** ISO timestamp of the closing, or null while the cycle is open. */
  readonly closedAt: string | null;
  /** Declared completion date (YYYY-MM-DD), or null while the cycle is open. */
  readonly effectiveCompletionDate: string | null;
  readonly sessionCount: number;
}

export function listTerritoryCycles(territoryId: number): Promise<{ cycles: readonly TerritoryCycle[] }> {
  return request(`/admin/territories/${territoryId}/cycles`);
}

export function changeTerritoryOperationalState(
  territoryId: number,
  input: { action: Exclude<OperationalState, 'no_record'>; reason?: string; effectiveCompletionDate?: string }
): Promise<TerritoryOperationalStatus> {
  return request(`/admin/territories/${territoryId}/operational-state`, { method: 'POST', body: JSON.stringify(input) });
}

export function createShareToken(
  territoryId: number,
  input: { expiresAt?: string } = {}
): Promise<ShareToken> {
  return request(`/admin/territories/${territoryId}/share-tokens`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function revokeShareToken(tokenId: number): Promise<void> {
  return request(`/admin/share-tokens/${tokenId}/revoke`, { method: 'POST', body: JSON.stringify({}) });
}

export interface TerritoryOverviewMonth {
  readonly month: string;
  readonly times: number;
}

/** One row of the administrator's overview. Deliberately carries no volunteer identity — this view speaks about territories, not people. */
export interface TerritoryOverviewRow {
  readonly id: number;
  readonly number: string | null;
  readonly name: string;
  readonly status: 'active' | 'archived';
  readonly areaHectares: number | null;
  /** All-time, never windowed: this is what separates "never worked" from "nothing in the visible months". */
  readonly lastWorkedAt: string | null;
  readonly monthly: readonly TerritoryOverviewMonth[];
}

export function getTerritoryOverview(
  options: { months?: number; includeArchived?: boolean } = {}
): Promise<{ territories: readonly TerritoryOverviewRow[] }> {
  const params = new URLSearchParams();
  if (options.months !== undefined) params.set('months', String(options.months));
  if (options.includeArchived) params.set('includeArchived', 'true');
  const query = params.toString();
  return request(`/admin/territories/overview${query === '' ? '' : `?${query}`}`);
}

export function setTerritoryNumber(territoryId: number, number: string): Promise<Territory> {
  return request(`/admin/territories/${territoryId}/number`, {
    method: 'PATCH',
    body: JSON.stringify({ number })
  });
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
  duplicate_territory_number: 'Ese número ya lo tiene otro territorio.',
  covered_area_not_remaining: 'El área cubierta no se superpone con el área pendiente del ciclo (quizás ya estaba cubierta).',
  territory_not_open: 'El territorio está cerrado. Ábrelo para registrar progreso.',
  baseline_required: 'Este ciclo todavía no tiene un área pendiente registrada; hay que confirmar desde dónde parte.',
  network_error: 'No se pudo conectar con el servidor.',
  invalid_credentials: 'Correo o contraseña incorrectos.',
  unauthorized: 'Tu sesión terminó. Vuelve a iniciar sesión.',
  forbidden_origin: 'La solicitud no viene de la aplicación de administración.',
  unexpected_error: 'Ocurrió un error inesperado; no se guardó nada.'
};

export function describeApiError(error: ApiError): string {
  return ERROR_MESSAGES_ES[error.code] ?? error.message;
}
