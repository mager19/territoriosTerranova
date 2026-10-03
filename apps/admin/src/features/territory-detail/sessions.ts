/**
 * Pure helpers for coverage sessions (2026-09-26 product decision): which
 * sessions belong to the current cycle, the color each one is drawn in, the
 * map features for them, and the request a new session sends. No MapLibre,
 * no React — unit-tested in sessions.test.ts.
 */

import type { FeatureCollection, MultiPolygon, Polygon } from '@territorios/geo';

import type { CoverageBaseline, ProgressEntry, RecordSessionInput } from '../../api/client.js';
import { draftToPolygonGeoJSON, type DraftState } from '../territory-editor/draft.js';

/**
 * Distinct, map-legible hues for consecutive sessions. None is the draft
 * orange (#e08a2e), the territory teal (#2f6f5e), or the remaining-area
 * magenta (#b0339a), so a session never reads as one of those layers.
 */
export const SESSION_COLORS: readonly string[] = [
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#dc2626',
  '#65a30d',
  '#db2777'
];

/** Colors cycle once there are more sessions than hues; the session list always pairs a color with its number. */
export function sessionColor(index: number): string {
  const length = SESSION_COLORS.length;
  return SESSION_COLORS[((index % length) + length) % length] ?? '#2563eb';
}

/** A session of the current cycle that recorded a covered area, with its display number and color. */
export interface CoverageSession {
  readonly entry: ProgressEntry;
  readonly coveredArea: Polygon | MultiPolygon;
  /** 1-based, in recording order within the cycle. */
  readonly number: number;
  readonly color: string;
}

/**
 * Sessions of `cycleNumber` that carry a covered area, oldest first. An
 * unknown cycle (null) has no sessions to show — older cycles are history,
 * not current coverage.
 */
export function currentCycleSessions(
  entries: readonly ProgressEntry[],
  cycleNumber: number | null
): readonly CoverageSession[] {
  if (cycleNumber === null) return [];
  const sessions: CoverageSession[] = [];
  for (const entry of entries) {
    if (entry.cycleNumber !== cycleNumber || entry.coveredArea === null) continue;
    const index = sessions.length;
    sessions.push({ entry, coveredArea: entry.coveredArea, number: index + 1, color: sessionColor(index) });
  }
  return sessions;
}

/** Map features for the sessions layer (map-editor.ts `installSessionLayers`). */
export function sessionFeatureCollection(
  sessions: readonly CoverageSession[],
  highlightedEntryId: number | null
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: sessions.map((session) => ({
      type: 'Feature',
      properties: {
        entryId: session.entry.id,
        color: session.color,
        highlighted: session.entry.id === highlightedEntryId
      },
      geometry: session.coveredArea
    }))
  };
}

/** "Nothing left" is an explicit empty polygon — never the same as unknown (null). */
export function isNothingRemaining(geometry: Polygon | MultiPolygon | null): boolean {
  return geometry !== null && geometry.coordinates.length === 0;
}

export interface SessionDraftInput {
  readonly recordedBy: string;
  readonly covered: DraftState;
  readonly note: string;
  readonly baseline?: CoverageBaseline;
}

/**
 * The POST body for a new session, or null while the covered area — the one
 * required part — is not a closed polygon yet. Never a remaining area,
 * which only the server computes. The recorder no longer captures a route
 * or a pause point (2026-10-03 product decision); the API still accepts
 * them as optional fields, but this request never sends them.
 */
export function buildSessionRequest(input: SessionDraftInput): RecordSessionInput | null {
  const coveredArea = draftToPolygonGeoJSON(input.covered);
  if (coveredArea === null) return null;
  const note = input.note.trim();
  return {
    recordedBy: input.recordedBy,
    coveredArea,
    ...(note === '' ? {} : { note }),
    ...(input.baseline === undefined ? {} : { baseline: input.baseline })
  };
}
