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
 * Seeds a draft from an existing saved polygon (a territory's current
 * revision) so its points can be dragged into place instead of redrawn
 * from scratch. Drops the repeated closing position RFC 7946 requires on
 * the wire — the draft's own closed-ring construction
 * (draftToPolygonGeoJSON) re-adds it on save, so there is exactly one
 * place that decides how the ring closes.
 */
export function draftFromPolygon(coordinates: readonly (readonly (readonly number[])[])[]): DraftState {
  const ring = coordinates[0] ?? [];
  const vertices = (ring.length > 1 ? ring.slice(0, -1) : ring).map(
    ([lon, lat]) => [lon, lat] as Coordinate
  );
  return { vertices, isClosed: true };
}

/**
 * Repositions one existing vertex by index — the point-by-point edit this
 * module otherwise has no way to express (every other function only
 * appends, removes the most recent, or closes/resets the whole draft). A
 * no-op for an out-of-range index rather than throwing, so a stale drag
 * handle from a re-rendered draft can never corrupt state.
 */
export function moveVertex(state: DraftState, index: number, vertex: Coordinate): DraftState {
  if (index < 0 || index >= state.vertices.length) {
    return state;
  }
  const vertices = state.vertices.slice();
  vertices[index] = vertex;
  return { ...state, vertices };
}

/**
 * Inserts a new vertex right after `afterIndex` — for adding a point mid-
 * boundary on an irregular site, not just at the end. `afterIndex` wraps
 * (an insert after the last vertex lands between the last and first,
 * i.e. on the closing edge), so every edge of a closed ring, including the
 * one back to the start, is reachable. A no-op for an out-of-range index.
 */
export function insertVertex(state: DraftState, afterIndex: number, vertex: Coordinate): DraftState {
  if (afterIndex < 0 || afterIndex >= state.vertices.length) {
    return state;
  }
  const vertices = state.vertices.slice();
  vertices.splice(afterIndex + 1, 0, vertex);
  return { ...state, vertices };
}

/**
 * Removes the vertex at `index` — for dropping a point that shouldn't have
 * been there, without redrawing the whole shape. Refuses to go below
 * `minVertices` (default 3, the minimum a valid closed ring needs —
 * closeDraft's own rule) rather than producing a draft that could never be
 * saved; a no-op in that case, same as an out-of-range index. A route
 * (never closed) passes 2 here — RFC 7946's own LineString minimum,
 * draftToLineStringGeoJSON's rule.
 */
export function removeVertexAt(state: DraftState, index: number, minVertices: number = MIN_VERTICES_TO_CLOSE): DraftState {
  if (index < 0 || index >= state.vertices.length || state.vertices.length <= minVertices) {
    return state;
  }
  const vertices = state.vertices.slice();
  vertices.splice(index, 1);
  return { ...state, vertices };
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

export interface DraftLineStringGeoJSON {
  readonly type: 'LineString';
  readonly coordinates: readonly Coordinate[];
}

/** Converts one WGS84 draft coordinate into the RFC 7946 Point used for a progress pause marker. */
export function coordinateToPointGeoJSON(coordinate: Coordinate): { readonly type: 'Point'; readonly coordinates: Coordinate } {
  return { type: 'Point', coordinates: coordinate };
}

/**
 * Converts an in-progress draft into RFC 7946 GeoJSON as an open
 * LineString — for recording a progress route (ProgressRecorder), reusing
 * the exact same click-to-add-vertex draft this module already gives
 * TerritoryEditor. A route never "closes" (closeDraft/isClosed simply
 * never gets called by that caller); the only requirement is RFC 7946's
 * own minimum of 2 positions for a LineString.
 */
export function draftToLineStringGeoJSON(state: DraftState): DraftLineStringGeoJSON | null {
  if (state.vertices.length < 2) {
    return null;
  }
  return { type: 'LineString', coordinates: state.vertices };
}
