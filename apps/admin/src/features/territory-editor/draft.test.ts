import { describe, expect, it } from 'vitest';

import {
  addVertex,
  closeDraft,
  coordinateToPointGeoJSON,
  createDraft,
  draftFromPolygon,
  draftToLineStringGeoJSON,
  draftToPolygonGeoJSON,
  insertVertex,
  moveVertex,
  removeVertexAt,
  resetDraft,
  undoVertex
} from './draft.js';

const V1 = [-75.574, 6.357] as const;
const V2 = [-75.572, 6.357] as const;
const V3 = [-75.572, 6.359] as const;
const V4 = [-75.574, 6.359] as const;

describe('addVertex / undoVertex', () => {
  it('appends vertices in order', () => {
    let state = createDraft();
    state = addVertex(state, V1);
    state = addVertex(state, V2);
    expect(state.vertices).toEqual([V1, V2]);
    expect(state.isClosed).toBe(false);
  });

  it('undo removes only the most recent vertex', () => {
    let state = createDraft();
    state = addVertex(state, V1);
    state = addVertex(state, V2);
    state = undoVertex(state);
    expect(state.vertices).toEqual([V1]);
  });

  it('undo on an empty draft is a no-op', () => {
    const state = undoVertex(createDraft());
    expect(state.vertices).toEqual([]);
  });

  it('undo on a closed draft is a no-op — closing is a deliberate boundary', () => {
    let state = createDraft();
    state = addVertex(state, V1);
    state = addVertex(state, V2);
    state = addVertex(state, V3);
    state = closeDraft(state);
    const afterUndo = undoVertex(state);
    expect(afterUndo).toEqual(state);
  });

  it('adding a vertex after closing starts a fresh draft (does not silently extend a closed polygon)', () => {
    let state = createDraft();
    state = addVertex(state, V1);
    state = addVertex(state, V2);
    state = addVertex(state, V3);
    state = closeDraft(state);

    const nextVertex = [-75.57, 6.36] as const;
    const restarted = addVertex(state, nextVertex);
    expect(restarted.isClosed).toBe(false);
    expect(restarted.vertices).toEqual([nextVertex]);
  });
});

describe('closeDraft', () => {
  it('requires at least 3 vertices — the minimum for a valid closed ring', () => {
    let state = createDraft();
    state = addVertex(state, V1);
    state = addVertex(state, V2);
    const stillOpen = closeDraft(state);
    expect(stillOpen.isClosed).toBe(false);
  });

  it('closes with exactly 3 vertices', () => {
    let state = createDraft();
    state = addVertex(state, V1);
    state = addVertex(state, V2);
    state = addVertex(state, V3);
    const closed = closeDraft(state);
    expect(closed.isClosed).toBe(true);
    expect(closed.vertices).toEqual([V1, V2, V3]);
  });

  it('closing an already-closed draft is a no-op', () => {
    let state = createDraft();
    state = addVertex(state, V1);
    state = addVertex(state, V2);
    state = addVertex(state, V3);
    state = closeDraft(state);
    expect(closeDraft(state)).toEqual(state);
  });
});

describe('resetDraft', () => {
  it('returns an empty, open draft', () => {
    expect(resetDraft()).toEqual({ vertices: [], isClosed: false });
  });
});

describe('draftToPolygonGeoJSON', () => {
  it('returns null for an unclosed draft', () => {
    let state = createDraft();
    state = addVertex(state, V1);
    state = addVertex(state, V2);
    state = addVertex(state, V3);
    expect(draftToPolygonGeoJSON(state)).toBeNull();
  });

  it('returns null for a draft with fewer than 3 vertices, even if somehow marked closed', () => {
    // closeDraft() itself would refuse this, but the converter must not
    // trust that invariant blindly — it re-checks vertex count itself.
    const impossibleState = { vertices: [V1, V2], isClosed: true };
    expect(draftToPolygonGeoJSON(impossibleState)).toBeNull();
  });

  it('produces a closed ring: first position repeated as the last', () => {
    let state = createDraft();
    state = addVertex(state, V1);
    state = addVertex(state, V2);
    state = addVertex(state, V3);
    state = closeDraft(state);

    const geojson = draftToPolygonGeoJSON(state);
    expect(geojson).not.toBeNull();
    expect(geojson?.type).toBe('Polygon');
    const ring = geojson?.coordinates[0];
    expect(ring).toHaveLength(4);
    expect(ring?.[0]).toEqual(ring?.[3]);
    expect(ring?.[0]).toEqual(V1);
  });

  it('preserves [longitude, latitude] coordinate order — reversing it puts Bello in the ocean', () => {
    let state = createDraft();
    // Bello is at roughly [-75.56, 6.34]: longitude negative and larger in
    // magnitude than latitude. A swapped-order bug would put the "longitude"
    // near 6 and "latitude" near -75, which is nonsensical on Earth — this
    // test would catch a swap even without knowing Bello's coordinates.
    state = addVertex(state, [-75.574, 6.357]);
    state = addVertex(state, [-75.572, 6.357]);
    state = addVertex(state, [-75.572, 6.359]);
    state = closeDraft(state);

    const ring = draftToPolygonGeoJSON(state)?.coordinates[0] ?? [];
    for (const [lon, lat] of ring) {
      expect(lon).toBeLessThan(-75);
      expect(lat).toBeGreaterThan(0);
      expect(lat).toBeLessThan(10);
    }
  });
});

describe('draftFromPolygon', () => {
  it('seeds a closed draft from an existing ring, dropping the repeated closing position', () => {
    const state = draftFromPolygon([[V1, V2, V3, V1]]);
    expect(state.isClosed).toBe(true);
    expect(state.vertices).toEqual([V1, V2, V3]);
  });

  it('the seeded draft converts back to the same ring on save', () => {
    const state = draftFromPolygon([[V1, V2, V3, V1]]);
    expect(draftToPolygonGeoJSON(state)).toEqual({ type: 'Polygon', coordinates: [[V1, V2, V3, V1]] });
  });

  it('a seeded draft is not extendable by clicking — same rule as any other closed draft', () => {
    const state = draftFromPolygon([[V1, V2, V3, V1]]);
    const nextVertex = [-75.57, 6.36] as const;
    const restarted = addVertex(state, nextVertex);
    expect(restarted.vertices).toEqual([nextVertex]);
  });
});

describe('moveVertex', () => {
  it('replaces the vertex at the given index, leaving the others untouched', () => {
    const state = draftFromPolygon([[V1, V2, V3, V1]]);
    const moved = moveVertex(state, 1, [-75.5, 6.4]);
    expect(moved.vertices).toEqual([V1, [-75.5, 6.4], V3]);
  });

  it('preserves the closed flag — moving a point is not the same as re-opening the draft', () => {
    const state = draftFromPolygon([[V1, V2, V3, V1]]);
    const moved = moveVertex(state, 0, [-75.5, 6.4]);
    expect(moved.isClosed).toBe(true);
  });

  it('is a no-op for an out-of-range index rather than throwing', () => {
    const state = draftFromPolygon([[V1, V2, V3, V1]]);
    expect(moveVertex(state, 99, [-75.5, 6.4])).toEqual(state);
    expect(moveVertex(state, -1, [-75.5, 6.4])).toEqual(state);
  });
});

describe('insertVertex', () => {
  it('inserts a new vertex right after the given index', () => {
    const state = draftFromPolygon([[V1, V2, V3, V1]]);
    const inserted = insertVertex(state, 0, [-75.573, 6.357]);
    expect(inserted.vertices).toEqual([V1, [-75.573, 6.357], V2, V3]);
  });

  it('inserting after the last vertex lands on the closing edge, back at the start', () => {
    const state = draftFromPolygon([[V1, V2, V3, V1]]);
    const inserted = insertVertex(state, 2, [-75.573, 6.358]);
    expect(inserted.vertices).toEqual([V1, V2, V3, [-75.573, 6.358]]);
  });

  it('preserves the closed flag', () => {
    const state = draftFromPolygon([[V1, V2, V3, V1]]);
    expect(insertVertex(state, 0, [-75.573, 6.357]).isClosed).toBe(true);
  });

  it('is a no-op for an out-of-range index rather than throwing', () => {
    const state = draftFromPolygon([[V1, V2, V3, V1]]);
    expect(insertVertex(state, 99, [-75.573, 6.357])).toEqual(state);
    expect(insertVertex(state, -1, [-75.573, 6.357])).toEqual(state);
  });
});

describe('removeVertexAt', () => {
  it('removes the vertex at the given index, leaving the others in order', () => {
    const state = draftFromPolygon([[V1, V2, V3, V4, V1]]);
    const removed = removeVertexAt(state, 1);
    expect(removed.vertices).toEqual([V1, V3, V4]);
  });

  it('preserves the closed flag', () => {
    const state = draftFromPolygon([[V1, V2, V3, V4, V1]]);
    expect(removeVertexAt(state, 1).isClosed).toBe(true);
  });

  it('refuses to go below the 3-vertex minimum a valid ring needs', () => {
    const state = draftFromPolygon([[V1, V2, V3, V1]]);
    expect(removeVertexAt(state, 0)).toEqual(state);
  });

  it('accepts a lower minimum for a route, which only needs 2 points (RFC 7946 LineString)', () => {
    const state = draftFromPolygon([[V1, V2, V3, V1]]); // 3 vertices before closing
    const removed = removeVertexAt(state, 0, 2);
    expect(removed.vertices).toEqual([V2, V3]);
    expect(removeVertexAt(removed, 0, 2)).toEqual(removed); // now at the 2-point floor
  });

  it('is a no-op for an out-of-range index rather than throwing', () => {
    const state = draftFromPolygon([[V1, V2, V3, V4, V1]]);
    expect(removeVertexAt(state, 99)).toEqual(state);
    expect(removeVertexAt(state, -1)).toEqual(state);
  });
});

describe('draftToLineStringGeoJSON', () => {
  it("returns null for fewer than 2 vertices — RFC 7946's own LineString minimum", () => {
    let state = createDraft();
    expect(draftToLineStringGeoJSON(state)).toBeNull();
    state = addVertex(state, V1);
    expect(draftToLineStringGeoJSON(state)).toBeNull();
  });

  it('converts an open (never-closed) draft into a LineString, in click order', () => {
    let state = createDraft();
    state = addVertex(state, V1);
    state = addVertex(state, V2);
    state = addVertex(state, V3);
    expect(draftToLineStringGeoJSON(state)).toEqual({ type: 'LineString', coordinates: [V1, V2, V3] });
  });

  it('does not require the draft to be closed — a route never closes', () => {
    let state = createDraft();
    state = addVertex(state, V1);
    state = addVertex(state, V2);
    expect(state.isClosed).toBe(false);
    expect(draftToLineStringGeoJSON(state)).not.toBeNull();
  });
});

describe('coordinateToPointGeoJSON', () => {
  it('preserves GeoJSON longitude-latitude order for a pause marker', () => {
    expect(coordinateToPointGeoJSON(V1)).toEqual({ type: 'Point', coordinates: V1 });
  });
});
