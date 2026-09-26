/**
 * Pure lon/lat → SVG thumbnail mapping for territory cards.
 *
 * This is deliberately NOT a MapLibre/WebGL map: browsers cap the number of
 * live WebGL contexts (~8–16), so a map per territory card would break the
 * grid the moment there are more than a handful of territories. Instead we
 * render the territory's polygon as a single inline SVG shape — no tiles,
 * no WebGL, deterministic and side-effect-free (no DOM, no MapLibre).
 */

import type { Polygon } from '@territorios/geo';

/** The outer ring's points mapped into an SVG viewBox. */
export interface ThumbnailSvg {
  /** e.g. "0 0 120 120" — the coordinate space the points live in. */
  readonly viewBox: string;
  /** The outer ring as "x,y x,y …", ready for an SVG `<polygon points>`. */
  readonly points: string;
}

/** Small inset (in SVG units) so the polygon never touches the viewBox edge. */
const PADDING = 8;

/**
 * Map a territory polygon to an SVG polygon string.
 *
 * Reads ONLY the outer ring (`coordinates[0]`; territories have no holes),
 * computes the lon/lat bounding box, then linearly maps lon→x and lat→y with
 * the Y axis flipped (north is up). Aspect ratio is preserved by using a
 * single uniform scale for both axes; the result is centered in the viewBox
 * with a small padding so it is never clipped.
 */
export function polygonToThumbnail(polygon: Polygon, width = 120, height = 120): ThumbnailSvg {
  const viewBox = `0 0 ${width} ${height}`;
  const ring = polygon.coordinates[0];
  if (!ring || ring.length === 0) {
    return { viewBox, points: '' };
  }

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat;
  const availableWidth = width - PADDING * 2;
  const availableHeight = height - PADDING * 2;

  // One uniform scale for both axes preserves aspect ratio; a zero span
  // (degenerate, should not happen for validated territory geometry) falls
  // back to 1 so we never divide by zero.
  const scale = Math.min(
    lonSpan === 0 ? 1 : availableWidth / lonSpan,
    latSpan === 0 ? 1 : availableHeight / latSpan
  );

  const drawnWidth = lonSpan * scale;
  const drawnHeight = latSpan * scale;
  const offsetX = (width - drawnWidth) / 2;
  const offsetY = (height - drawnHeight) / 2;

  const points = ring
    .map(([lon, lat]) => {
      const x = offsetX + (lon - minLon) * scale;
      // Flip Y: larger latitude (north) maps to a smaller SVG y.
      const y = offsetY + (maxLat - lat) * scale;
      return `${x},${y}`;
    })
    .join(' ');

  return { viewBox, points };
}
