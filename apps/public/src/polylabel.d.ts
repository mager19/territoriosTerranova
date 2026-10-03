// polylabel 2.x ships no type declarations (layers.ts territoryLabelPoint).
declare module 'polylabel' {
  /**
   * The pole of inaccessibility of a polygon given as GeoJSON-style rings
   * (outer ring first, then holes): the interior point farthest from any edge.
   */
  export default function polylabel(
    polygon: readonly (readonly (readonly number[])[])[],
    precision?: number,
    debug?: boolean
  ): number[] & { distance: number };
}
