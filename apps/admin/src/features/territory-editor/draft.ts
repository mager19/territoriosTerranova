/**
 * Pure territory-drawing state — no MapLibre, no DOM, no rendering (A5
 * brief hard constraint: "Keep drawing state in pure, testable functions
 * separate from MapLibre. The map is a rendering surface, not the model.").
 *
 * Every function here takes a DraftState and returns a new one; none of
 * them touch a map instance. `map-editor.ts` is the thin, untested-in-Node
 * glue that turns MapLibre clicks into calls into this module and renders
 * its output as a GeoJSON layer.
 *
 * Coordinate order is [longitude, latitude] throughout — GeoJSON order, and
 * what MapLibre's own unproject() returns. Reversing it puts Bello in the
 * Indian Ocean and the bug survives review because both numbers look
 * plausible (A5 brief).
 */

export type Coordinate = readonly [longitude: number, latitude: number];

export interface DraftState {
  readonly vertices: readonly Coordinate[];
  readonly isClosed: boolean;
}

export interface DraftPolygonGeoJSON {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly Coordinate[])[];
}

const MIN_VERTICES_TO_CLOSE = 3;

export function createDraft(): DraftState {
  return { vertices: [], isClosed: false };
}

/** Adding a vertex after closing starts a fresh draft with just that vertex — a closed draft is done, not extendable. */
export function addVertex(state: DraftState, vertex: Coordinate): DraftState {
  if (state.isClosed) {
    return { vertices: [vertex], isClosed: false };
  }
  return { vertices: [...state.vertices, vertex], isClosed: false };
}

/** Removes the most recent vertex. A no-op on an empty or already-closed draft. */
export function undoVertex(state: DraftState): DraftState {
  if (state.isClosed || state.vertices.length === 0) {
    return state;
  }
  return { vertices: state.vertices.slice(0, -1), isClosed: false };
}

/**
 * Closes the draft, requiring at least 3 distinct vertices — the minimum
 * that produces a valid closed ring (3 distinct positions + the repeated
 * first position = 4, RFC 7946 §3.1.6's minimum). Fewer vertices: no-op,
 * returns the state unchanged so the caller can decide how to surface that.
 */
export function closeDraft(state: DraftState): DraftState {
  if (state.isClosed || state.vertices.length < MIN_VERTICES_TO_CLOSE) {
    return state;
  }
  return { vertices: state.vertices, isClosed: true };
}

export function resetDraft(): DraftState {
  return createDraft();
}

/**
 * Converts a closed draft into RFC 7946 GeoJSON: a single ring, first
 * position repeated as the last (closed). Returns null for an unclosed or
 * too-short draft — never a degenerate or self-closing-by-accident polygon.
 */
export function draftToPolygonGeoJSON(state: DraftState): DraftPolygonGeoJSON | null {
  if (!state.isClosed || state.vertices.length < MIN_VERTICES_TO_CLOSE) {
    return null;
  }
  const ring = [...state.vertices, state.vertices[0]] as readonly Coordinate[];
  return { type: 'Polygon', coordinates: [ring] };
}
