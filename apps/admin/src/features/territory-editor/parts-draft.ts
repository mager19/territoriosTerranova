/**
 * Multi-part territory drawing state (2026-10-03, option A: a territory may
 * be several disjoint parts worked as ONE territory). Pure, like draft.ts:
 * no MapLibre, no DOM.
 *
 * Every part is a DraftState from draft.ts; exactly one part is ACTIVE —
 * the one the drawing and vertex-editing tools act on. The other parts stay
 * visible on the map and can be selected (clicked) to become active once
 * the active part is closed. Save sends the canonical shape the API
 * returns: a Polygon for one part, a MultiPolygon for two or more.
 *
 * Whether parts overlap, touch, or leave Bello is decided by the server
 * (db/migrations/0012), never repaired here.
 */

import { combineParts, polygonParts, type Polygon, type TerritoryGeometry } from '@territorios/geo';

import { createDraft, draftFromPolygon, draftToPolygonGeoJSON, type DraftState } from './draft.js';

export interface PartsDraftState {
  /** At least one part. */
  readonly parts: readonly DraftState[];
  readonly activeIndex: number;
}

export interface IndexedPartPolygon {
  readonly index: number;
  readonly polygon: Polygon;
}

export function createPartsDraft(): PartsDraftState {
  return { parts: [createDraft()], activeIndex: 0 };
}

export function activePart(state: PartsDraftState): DraftState {
  return state.parts[state.activeIndex] ?? createDraft();
}

/** Applies a draft.ts operation to the active part only. */
export function updateActivePart(state: PartsDraftState, update: (draft: DraftState) => DraftState): PartsDraftState {
  const parts = state.parts.slice();
  parts[state.activeIndex] = update(activePart(state));
  return { ...state, parts };
}

function allClosed(state: PartsDraftState): boolean {
  return state.parts.every((part) => part.isClosed);
}

/** A new part can start only once every existing part is closed. */
export function canAddPart(state: PartsDraftState): boolean {
  return allClosed(state);
}

/** "Agregar otra parte": appends an empty part and makes it active. */
export function addPart(state: PartsDraftState): PartsDraftState {
  if (!canAddPart(state)) return state;
  return { parts: [...state.parts, createDraft()], activeIndex: state.parts.length };
}

/** "Quitar esta parte": removes the active part, never the last one. The previous part becomes active. */
export function removeActivePart(state: PartsDraftState): PartsDraftState {
  if (state.parts.length <= 1) return state;
  const parts = state.parts.filter((_, index) => index !== state.activeIndex);
  return { parts, activeIndex: Math.max(0, state.activeIndex - 1) };
}

/** Another part can be selected only while the active one is closed — an unfinished part is never left behind. */
export function canSelectPart(state: PartsDraftState): boolean {
  return activePart(state).isClosed;
}

export function selectPart(state: PartsDraftState, index: number): PartsDraftState {
  if (!canSelectPart(state) || index < 0 || index >= state.parts.length || index === state.activeIndex) return state;
  return { ...state, activeIndex: index };
}

/** The geometry to save, or null while any part is unfinished. */
export function partsDraftToGeometry(state: PartsDraftState): TerritoryGeometry | null {
  const polygons: Polygon[] = [];
  for (const part of state.parts) {
    const polygon = draftToPolygonGeoJSON(part);
    if (polygon === null) return null;
    polygons.push(polygon);
  }
  return combineParts(polygons);
}

/** Seeds one closed part per saved part (first part active), for "Editar forma actual". */
export function partsDraftFromGeometry(geometry: TerritoryGeometry): PartsDraftState {
  return { parts: polygonParts(geometry).map((part) => draftFromPolygon(part.coordinates)), activeIndex: 0 };
}

function closedPolygons(state: PartsDraftState, includeActive: boolean): IndexedPartPolygon[] {
  const result: IndexedPartPolygon[] = [];
  state.parts.forEach((part, index) => {
    if (!includeActive && index === state.activeIndex) return;
    const polygon = draftToPolygonGeoJSON(part);
    if (polygon !== null) result.push({ index, polygon });
  });
  return result;
}

/** Closed parts other than the active one — drawn as "other parts", selectable, and snap targets. */
export function inactivePartPolygons(state: PartsDraftState): IndexedPartPolygon[] {
  return closedPolygons(state, false);
}

/** Every closed part, the active one included. */
export function closedPartPolygons(state: PartsDraftState): IndexedPartPolygon[] {
  return closedPolygons(state, true);
}
