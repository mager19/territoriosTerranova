/**
 * Pure, WebGL-free description of what the public map draws: layer colors,
 * which layers a given view actually has, and the legend derived from
 * that. Kept out of map.ts (which drives a
 * real MapLibre instance) so all of it is unit-testable in happy-dom — the
 * same separation map.ts already keeps for computeBoundingBox.
 */

import type { MultiPolygon, Polygon } from '@territorios/geo';
import polylabel from 'polylabel';

import type { PublicTerritoryView } from './public-api.js';

/** One palette shared by the map layers and the legend swatches, so they can never drift apart. */
export const LAYER_COLORS = {
  /** Muted green: the area already done in the current cycle. */
  covered: '#5f9e6e',
  /** Neutral gray: what is still pending. */
  remaining: '#c9c9c9',
  /** Near-black: the recorded route line, the darkest element on the map. */
  route: '#161616'
} as const;

/**
 * An area worth drawing: present and not the API's explicit empty polygon
 * ("nothing left" / "nothing done"), which has nothing to draw.
 */
export function hasDrawableArea(area: Polygon | MultiPolygon | null): area is Polygon | MultiPolygon {
  // Truthiness, not `!== null`: a defensive read that also tolerates a
  // field missing from a view object built outside public-api.ts parsing.
  if (!area) return false;
  return area.coordinates.length > 0;
}

export type LegendKey = 'covered' | 'remaining' | 'route';

export interface LegendItem {
  readonly key: LegendKey;
  readonly label: string;
  readonly color: string;
  readonly shape: 'area' | 'line';
}

type LegendView = Pick<PublicTerritoryView, 'coveredArea' | 'remainingArea' | 'route'>;

/** Legend entries for ONLY the layers this view actually draws, in map stacking order (bottom to top). */
export function legendItems(view: LegendView): LegendItem[] {
  const items: LegendItem[] = [];
  if (hasDrawableArea(view.coveredArea)) {
    items.push({ key: 'covered', label: 'Hecho', color: LAYER_COLORS.covered, shape: 'area' });
  }
  if (hasDrawableArea(view.remainingArea)) {
    items.push({ key: 'remaining', label: 'Pendiente', color: LAYER_COLORS.remaining, shape: 'area' });
  }
  if (view.route) {
    items.push({ key: 'route', label: 'Recorrido', color: LAYER_COLORS.route, shape: 'line' });
  }
  return items;
}

/** ~1 m at Bello's latitude: plenty for placing a label. */
const LABEL_PRECISION_DEGREES = 0.00001;

/**
 * Where the territory name sits on the map: the pole of inaccessibility
 * (the interior point farthest from every edge), not the centroid or the
 * bounding-box center, both of which can fall outside an L- or U-shaped
 * territory. Planar lon/lat math is fine at this scale.
 */
export function territoryLabelPoint(boundary: Polygon): [number, number] {
  const [lon, lat] = polylabel(boundary.coordinates, LABEL_PRECISION_DEGREES);
  return [lon as number, lat as number];
}

/**
 * The territory name drawn over the map as a DOM marker (2026-10-03). The
 * OSM raster style has no glyphs for a MapLibre symbol layer, and loading
 * them from elsewhere would break A6's no-external-assets rule; a DOM label
 * uses the app's own self-hosted font. The name is already public (it is
 * the page heading); it is set as text, never as HTML.
 */
export function createTerritoryLabelElement(name: string): HTMLDivElement {
  const label = document.createElement('div');
  label.className = 'territory-label';
  label.textContent = name;
  return label;
}
