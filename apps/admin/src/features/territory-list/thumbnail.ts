/**
 * Pure lon/lat → SVG thumbnail mapping for territory cards.
 *
 * This is deliberately NOT a MapLibre/WebGL map: browsers cap the number of
 * live WebGL contexts (~8–16), so a map per territory card would break the
 * grid the moment there are more than a handful of territories. Instead we
 * render the territory's polygon as a single inline SVG shape — no tiles,
 * no WebGL, deterministic and side-effect-free (no DOM, no MapLibre).
 */

import { polygonParts, type Polygon, type TerritoryGeometry } from '@territorios/geo';

/** The outer ring's points mapped into an SVG viewBox. */
export interface ThumbnailSvg {
  /** e.g. "0 0 120 120" — the coordinate space the points live in. */
  readonly viewBox: string;
  /** The outer ring as "x,y x,y …", ready for an SVG `<polygon points>`. */
  readonly points: string;
}

/** Every part of a (multi-part) territory mapped into ONE shared SVG viewBox. */
export interface MultiThumbnailSvg {
  readonly viewBox: string;
  /** One `<polygon points>` string per part, in part order. */
  readonly parts: readonly string[];
}

/** Small inset (in SVG units) so the polygon never touches the viewBox edge. */
const PADDING = 8;

/**
 * Map a territory geometry — every part of a MultiPolygon (0012) — to SVG
 * polygon strings sharing one viewBox, so the parts keep their real
 * relative positions and the gap between them.
 *
 * Reads ONLY each part's outer ring (`coordinates[0]`; territories have no
 * holes), computes the lon/lat bounding box over all parts, then linearly
 * maps lon→x and lat→y with the Y axis flipped (north is up). Aspect ratio
 * is preserved by using a single uniform scale for both axes; the result is
 * centered in the viewBox with a small padding so it is never clipped.
 */
export function geometryToThumbnail(geometry: TerritoryGeometry, width = 120, height = 120): MultiThumbnailSvg {
  const viewBox = `0 0 ${width} ${height}`;
  const rings = polygonParts(geometry)
    .map((part) => part.coordinates[0])
    .filter((ring) => ring !== undefined && ring.length > 0);
  if (rings.length === 0) {
    return { viewBox, parts: [] };
  }

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
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

  const parts = rings.map((ring) =>
    ring
      .map(([lon, lat]) => {
        const x = offsetX + (lon - minLon) * scale;
        // Flip Y: larger latitude (north) maps to a smaller SVG y.
        const y = offsetY + (maxLat - lat) * scale;
        return `${x},${y}`;
      })
      .join(' ')
  );

  return { viewBox, parts };
}

/** Single-polygon form of geometryToThumbnail (one part, one points string). */
export function polygonToThumbnail(polygon: Polygon, width = 120, height = 120): ThumbnailSvg {
  const { viewBox, parts } = geometryToThumbnail(polygon, width, height);
  return { viewBox, points: parts[0] ?? '' };
}
