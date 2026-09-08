/**
 * Thin fetch wrapper over A3's admin API. A5 brief DoD: "Server validation
 * errors are surfaced with their specific cause — never a generic
 * 'something went wrong'." ApiError always carries the server's own
 * `error` code and `message`; callers render THAT, never a fabricated
 * string.
 */

import type { LineString, Point, Polygon } from '@territorios/geo';

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

export type AssignmentStatus = 'active' | 'completed' | 'returned';

export interface Assignment {
  readonly id: number;
  readonly territoryId: number;
  readonly territoryRevisionId: number;
  readonly revisionNumber: number;
  readonly assignedTo: string;
  readonly assignedBy: string;
  readonly status: AssignmentStatus;
  readonly assignedAt: string;
  readonly completedAt: string | null;
  readonly returnedAt: string | null;
  readonly reopenReason: string | null;
}

export interface ProgressEntry {
  readonly id: number;
  readonly assignmentId: number;
  readonly recordedBy: string;
  readonly recordedAt: string;
  readonly note: string | null;
  readonly pausePoint: Point | null;
  readonly route: LineString | null;
  readonly remainingArea: Polygon | null;
  /** Explicit, never-inferred: 'unknown' means not recorded, never "fully covered" (AGENTS.md). */
  readonly remainingAreaStatus: 'recorded' | 'unknown';
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

export function listAssignments(territoryId: number): Promise<{ assignments: readonly Assignment[] }> {
  return request(`/admin/territories/${territoryId}/assignments`);
}

export function assignTerritory(
  territoryId: number,
  input: { assignedTo: string; assignedBy: string }
): Promise<Assignment> {
  return request(`/admin/territories/${territoryId}/assignments`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function returnAssignment(assignmentId: number, actor: string): Promise<Assignment> {
  return request(`/admin/assignments/${assignmentId}/return`, { method: 'POST', body: JSON.stringify({ actor }) });
}

export function completeAssignment(assignmentId: number, actor: string): Promise<Assignment> {
  return request(`/admin/assignments/${assignmentId}/complete`, { method: 'POST', body: JSON.stringify({ actor }) });
}

export function reopenAssignment(assignmentId: number, actor: string, reason: string): Promise<Assignment> {
  return request(`/admin/assignments/${assignmentId}/reopen`, {
    method: 'POST',
    body: JSON.stringify({ actor, reason })
  });
}

export function listProgress(assignmentId: number): Promise<{ entries: readonly ProgressEntry[] }> {
  return request(`/admin/assignments/${assignmentId}/progress`);
}
