/**
 * Thin fetch wrapper over A3's admin API. A5 brief DoD: "Server validation
 * errors are surfaced with their specific cause — never a generic
 * 'something went wrong'." ApiError always carries the server's own
 * `error` code and `message`; callers render THAT, never a fabricated
 * string.
 */

import type { Polygon } from '@territorios/geo';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000';

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
