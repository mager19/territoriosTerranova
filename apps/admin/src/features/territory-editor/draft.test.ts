import { describe, expect, it } from 'vitest';

import { addVertex, closeDraft, createDraft, draftToPolygonGeoJSON, resetDraft, undoVertex } from './draft.js';

const V1 = [-75.574, 6.357] as const;
const V2 = [-75.572, 6.357] as const;
const V3 = [-75.572, 6.359] as const;

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
