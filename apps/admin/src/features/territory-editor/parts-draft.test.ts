import { describe, expect, it } from 'vitest';

import type { MultiPolygon, Polygon } from '@territorios/geo';

import { addVertex, closeDraft, type Coordinate, type DraftState } from './draft.js';
import {
  activePart,
  addPart,
  canAddPart,
  canSelectPart,
  closedPartPolygons,
  createPartsDraft,
  inactivePartPolygons,
  partsDraftFromGeometry,
  partsDraftToGeometry,
  removeActivePart,
  selectPart,
  updateActivePart,
  type PartsDraftState
} from './parts-draft.js';

const A: Coordinate = [-75.56, 6.33];
const B: Coordinate = [-75.559, 6.33];
const C: Coordinate = [-75.559, 6.331];

function closedTriangle(offset = 0): DraftState {
  let draft: DraftState = { vertices: [], isClosed: false };
  for (const [lon, lat] of [A, B, C]) draft = addVertex(draft, [lon + offset, lat]);
  return closeDraft(draft);
}

function triangleRing(offset = 0): Coordinate[] {
  return [
    [A[0] + offset, A[1]],
    [B[0] + offset, B[1]],
    [C[0] + offset, C[1]],
    [A[0] + offset, A[1]]
  ];
}

function withParts(parts: DraftState[], activeIndex = parts.length - 1): PartsDraftState {
  return { parts, activeIndex };
}

describe('createPartsDraft', () => {
  it('starts with one empty active part', () => {
    const state = createPartsDraft();
    expect(state.parts).toHaveLength(1);
    expect(activePart(state)).toEqual({ vertices: [], isClosed: false });
  });
});

describe('updateActivePart', () => {
  it('applies a draft operation to the active part only', () => {
    const state = withParts([closedTriangle(), { vertices: [], isClosed: false }]);
    const next = updateActivePart(state, (draft) => addVertex(draft, A));
    expect(next.parts[0]).toEqual(closedTriangle());
    expect(activePart(next).vertices).toEqual([A]);
  });
});

describe('addPart ("Agregar otra parte")', () => {
  it('is only possible once every part is closed', () => {
    const open = updateActivePart(createPartsDraft(), (draft) => addVertex(draft, A));
    expect(canAddPart(open)).toBe(false);
    expect(addPart(open)).toBe(open);
  });

  it('appends a new empty part and makes it active, keeping the finished parts', () => {
    const next = addPart(withParts([closedTriangle()]));
    expect(next.parts).toHaveLength(2);
    expect(next.activeIndex).toBe(1);
    expect(next.parts[0]).toEqual(closedTriangle());
    expect(activePart(next)).toEqual({ vertices: [], isClosed: false });
  });
});

describe('removeActivePart ("Quitar esta parte")', () => {
  it('removes the active part and activates the previous one', () => {
    const state = withParts([closedTriangle(0), closedTriangle(0.01), closedTriangle(0.02)], 1);
    const next = removeActivePart(state);
    expect(next.parts).toEqual([closedTriangle(0), closedTriangle(0.02)]);
    expect(next.activeIndex).toBe(0);
  });

  it('never removes the last remaining part', () => {
    const state = withParts([closedTriangle()]);
    expect(removeActivePart(state)).toBe(state);
  });
});

describe('selectPart', () => {
  it('switches the active part when the active part is closed', () => {
    const state = withParts([closedTriangle(0), closedTriangle(0.01)], 1);
    expect(canSelectPart(state)).toBe(true);
    expect(selectPart(state, 0).activeIndex).toBe(0);
  });

  it('refuses to leave an unfinished part (it would be lost from view)', () => {
    const state = withParts([closedTriangle(0), { vertices: [A], isClosed: false }], 1);
    expect(canSelectPart(state)).toBe(false);
    expect(selectPart(state, 0)).toBe(state);
  });

  it('ignores an out-of-range index', () => {
    const state = withParts([closedTriangle(0), closedTriangle(0.01)], 1);
    expect(selectPart(state, 5)).toBe(state);
  });
});

describe('partsDraftToGeometry', () => {
  it('is null while any part is unfinished', () => {
    expect(partsDraftToGeometry(withParts([closedTriangle(), { vertices: [A], isClosed: false }]))).toBeNull();
    expect(partsDraftToGeometry(createPartsDraft())).toBeNull();
  });

  it('sends a Polygon for one part', () => {
    expect(partsDraftToGeometry(withParts([closedTriangle()]))).toEqual({
      type: 'Polygon',
      coordinates: [triangleRing()]
    });
  });

  it('sends a MultiPolygon for several parts, in part order', () => {
    expect(partsDraftToGeometry(withParts([closedTriangle(0), closedTriangle(0.01)]))).toEqual({
      type: 'MultiPolygon',
      coordinates: [[triangleRing(0)], [triangleRing(0.01)]]
    });
  });
});

describe('partsDraftFromGeometry ("Editar forma actual")', () => {
  it('loads a Polygon as one closed part', () => {
    const polygon: Polygon = { type: 'Polygon', coordinates: [triangleRing()] };
    expect(partsDraftFromGeometry(polygon)).toEqual(withParts([closedTriangle()], 0));
  });

  it('loads every part of a MultiPolygon, first part active', () => {
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [[triangleRing(0)], [triangleRing(0.01)]] };
    expect(partsDraftFromGeometry(multi)).toEqual(withParts([closedTriangle(0), closedTriangle(0.01)], 0));
  });
});

describe('inactivePartPolygons / closedPartPolygons', () => {
  it('lists the closed parts other than the active one, with their part index', () => {
    const state = withParts([closedTriangle(0), closedTriangle(0.01), { vertices: [A], isClosed: false }], 2);
    expect(inactivePartPolygons(state)).toEqual([
      { index: 0, polygon: { type: 'Polygon', coordinates: [triangleRing(0)] } },
      { index: 1, polygon: { type: 'Polygon', coordinates: [triangleRing(0.01)] } }
    ]);
  });

  it('lists every closed part, active included', () => {
    const state = withParts([closedTriangle(0), closedTriangle(0.01)], 1);
    expect(closedPartPolygons(state)).toHaveLength(2);
  });
});
