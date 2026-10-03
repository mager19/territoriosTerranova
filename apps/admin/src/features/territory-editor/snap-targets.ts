/**
 * Which geometries the territory editor snaps to (2026-10-03). Pure: no
 * MapLibre, no fetch.
 *
 * - The current geometry of every OTHER territory, from the admin list
 *   endpoint — never the territory being edited (snapping a revision onto
 *   its own previous shape would only fight the edit).
 * - The AMVA reference barrio the administrator selected, if any. It is an
 *   admin-only drafting reference and stays inside the admin app.
 *
 * `territories` is null until the list has loaded, and stays null if the
 * request failed: no territory snapping then, never a guessed target.
 */

import type { MultiPolygon, Polygon } from '@territorios/geo';

import type { TerritoryListItem } from '../../api/client.js';
import type { SnapGeometry } from './snap.js';

export function neighborTerritoryGeometries(
  territories: readonly TerritoryListItem[] | null,
  editingTerritoryId: number | null
): Polygon[] {
  if (territories === null) return [];
  const geometries: Polygon[] = [];
  for (const territory of territories) {
    if (territory.id === editingTerritoryId || territory.geometry === null) continue;
    geometries.push(territory.geometry);
  }
  return geometries;
}

export function editorSnapTargets(
  territories: readonly TerritoryListItem[] | null,
  editingTerritoryId: number | null,
  referenceBarrio: MultiPolygon | null
): SnapGeometry[] {
  const targets: SnapGeometry[] = neighborTerritoryGeometries(territories, editingTerritoryId);
  if (referenceBarrio !== null) targets.push(referenceBarrio);
  return targets;
}
