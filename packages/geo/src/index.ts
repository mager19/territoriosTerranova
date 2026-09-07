/**
 * Shared RFC 7946 (WGS84) GeoJSON primitives.
 *
 * Application-owned geometry is RFC 7946 WGS84 GeoJSON and is the system of
 * record (see AGENTS.md). This package is the skeleton seed: the data agent
 * (A2) owns its evolution — full geometry types and server-side validation
 * land there.
 */

/**
 * An RFC 7946 position: [longitude, latitude] with optional elevation.
 * Coordinates are WGS84 degrees; longitude in [-180, 180], latitude in
 * [-90, 90]. Range enforcement belongs to the A2 validation layer.
 */
export type Position = readonly [number, number] | readonly [number, number, number];

/**
 * Type guard for the position shape: an array of two or three finite numbers.
 * Deliberately structural — it does not judge coordinate-range validity.
 */
export function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    (value.length === 2 || value.length === 3) &&
    value.every(
      (component: unknown) => typeof component === 'number' && Number.isFinite(component)
    )
  );
}
