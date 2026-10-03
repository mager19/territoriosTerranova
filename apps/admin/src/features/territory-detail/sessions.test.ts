import { describe, expect, it } from 'vitest';

import type { ProgressEntry } from '../../api/client.js';
import { addVertex, closeDraft, createDraft, type DraftState } from '../territory-editor/draft.js';
import {
  SESSION_COLORS,
  buildSessionRequest,
  currentCycleSessions,
  isNothingRemaining,
  sessionColor,
  sessionFeatureCollection
} from './sessions.js';

const SQUARE = {
  type: 'Polygon' as const,
  coordinates: [[[-75.574, 6.357], [-75.572, 6.357], [-75.572, 6.359], [-75.574, 6.357]]] as [number, number][][]
};

function entry(overrides: Partial<ProgressEntry>): ProgressEntry {
  return {
    id: 1,
    territoryId: 1,
    cycleNumber: 1,
    recordedBy: 'admin',
    recordedAt: '2026-09-26T10:00:00.000Z',
    note: null,
    pausePoint: null,
    route: null,
    coveredArea: SQUARE,
    baseline: null,
    remainingArea: SQUARE,
    remainingAreaStatus: 'recorded',
    ...overrides
  };
}

function draftOf(vertices: readonly (readonly [number, number])[], close: boolean): DraftState {
  const open = vertices.reduce((draft, vertex) => addVertex(draft, vertex), createDraft());
  return close ? closeDraft(open) : open;
}

describe('currentCycleSessions', () => {
  it('keeps only the current cycle sessions that carry a covered area, numbered and colored in order', () => {
    const sessions = currentCycleSessions(
      [
        entry({ id: 1, cycleNumber: 1 }),
        entry({ id: 2, cycleNumber: 2 }),
        entry({ id: 3, cycleNumber: 2, coveredArea: null }),
        entry({ id: 4, cycleNumber: 2 })
      ],
      2
    );

    expect(sessions.map((session) => session.entry.id)).toEqual([2, 4]);
    expect(sessions.map((session) => session.number)).toEqual([1, 2]);
    expect(sessions.map((session) => session.color)).toEqual([SESSION_COLORS[0], SESSION_COLORS[1]]);
  });

  it('shows nothing for an unknown cycle — older cycles are history, not current coverage', () => {
    expect(currentCycleSessions([entry({ cycleNumber: 1 })], null)).toEqual([]);
  });
});

describe('sessionColor', () => {
  it('gives consecutive sessions distinct colors and cycles past the palette', () => {
    expect(sessionColor(0)).not.toBe(sessionColor(1));
    expect(sessionColor(SESSION_COLORS.length)).toBe(sessionColor(0));
  });
});

describe('sessionFeatureCollection', () => {
  it('carries each session color and marks only the highlighted one', () => {
    const sessions = currentCycleSessions([entry({ id: 7 }), entry({ id: 8 })], 1);
    const collection = sessionFeatureCollection(sessions, 8);

    expect(collection.features.map((feature) => feature.properties)).toEqual([
      { entryId: 7, color: SESSION_COLORS[0], highlighted: false },
      { entryId: 8, color: SESSION_COLORS[1], highlighted: true }
    ]);
    expect(collection.features[0]?.geometry).toEqual(SQUARE);
  });
});

describe('isNothingRemaining', () => {
  it('distinguishes the explicit empty polygon from unknown and from a real remainder', () => {
    expect(isNothingRemaining({ type: 'Polygon', coordinates: [] })).toBe(true);
    expect(isNothingRemaining(null)).toBe(false);
    expect(isNothingRemaining(SQUARE)).toBe(false);
  });
});

describe('buildSessionRequest', () => {
  const triangle: readonly (readonly [number, number])[] = [
    [-75.574, 6.357],
    [-75.573, 6.357],
    [-75.573, 6.358]
  ];

  it('returns null until the covered area is a closed polygon — it is the required part of a session', () => {
    expect(buildSessionRequest({ covered: draftOf(triangle, false), note: '' })).toBeNull();
  });

  it('sends the covered area only, never a remaining area, when no note was written', () => {
    const request = buildSessionRequest({ covered: draftOf(triangle, true), note: '   ' });

    expect(request).toEqual({
      coveredArea: { type: 'Polygon', coordinates: [[...triangle, triangle[0]]] }
    });
    expect(request).not.toHaveProperty('remainingArea');
  });

  it('adds the trimmed note and the baseline — and never a route or pause point (removed 2026-10-03)', () => {
    const request = buildSessionRequest({
      covered: draftOf(triangle, true),
      note: ' esquina norte ',
      baseline: 'whole_territory'
    });

    expect(request).toEqual({
      coveredArea: { type: 'Polygon', coordinates: [[...triangle, triangle[0]]] },
      note: 'esquina norte',
      baseline: 'whole_territory'
    });
    expect(request).not.toHaveProperty('route');
    expect(request).not.toHaveProperty('pausePoint');
  });
});
