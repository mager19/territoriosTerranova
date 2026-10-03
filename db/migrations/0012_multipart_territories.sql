-- 0012: Multi-part territories.
--
-- 2026-10-03 product decision (option A): a territory may consist of SEVERAL
-- DISJOINT PARTS (e.g. blocks on both sides of a creek) worked as ONE
-- territory — one name, one slug/public URL, one progress/cycle history.
--
-- Storage contract: territory_revisions.geom becomes geometry(MultiPolygon,
-- 4326). Every revision is stored as a MultiPolygon; a single-part territory
-- is a MultiPolygon with one part. Writers normalize input with ST_Multi().
-- The API unwraps a one-part MultiPolygon back to a Polygon on output (see
-- territory_geometry_unwrap below), so single-part territories look exactly
-- as they did before this migration.
--
-- Rules (the database stays the last line of defense, AGENTS.md):
--   * The existing CHECKs keep holding on the MultiPolygon as a whole:
--     territory_revisions_geom_valid (ST_IsValid) rejects parts that overlap
--     each other or share an edge — they are REJECTED, never ST_Union'ed or
--     repaired; territory_revisions_geom_not_empty and
--     territory_revisions_geom_has_area keep their meaning.
--   * NEW territory_revisions_geom_parts_have_area: EVERY part must clear the
--     same measured 1e-12 deg^2 zero-area epsilon (0002). Without it a
--     degenerate (collinear, ST_IsValid=true) part could ride along with a
--     real part and pass the total-area check.
--   * Containment (ST_Within the Bello boundary) and the active-overlap check
--     (0003 triggers) already operate on any geometry: they now judge the
--     whole MultiPolygon, so every part must be inside Bello and no part may
--     overlap another active territory (authorized exceptions still apply).
--
-- Immutability: ALTER COLUMN ... TYPE rewrites the table but does NOT fire
-- row-level triggers, so territory_revisions_immutable (BEFORE UPDATE OR
-- DELETE) is neither fired nor disabled; it keeps rejecting UPDATE/DELETE
-- afterwards. ST_Multi is lossless for a Polygon (same coordinates, one
-- part), so no revision's geometry changes meaning. The AFTER INSERT
-- containment/overlap triggers are likewise not fired by the rewrite. The
-- GiST index territory_revisions_geom_idx is rebuilt automatically.
--
-- progress_entries.covered_area / remaining_area are already
-- geometry(Geometry, 4326) restricted to Polygon/MultiPolygon by CHECK (0002,
-- 0007), so remaining area across several parts needs no change here.
--
-- Irreversible in practice: migrations are forward-only, and once a
-- multi-part revision exists it cannot be narrowed back to Polygon.

ALTER TABLE territory_revisions
  ALTER COLUMN geom TYPE geometry(MultiPolygon, 4326) USING ST_Multi(geom);

-- Smallest planar area among the parts of a (Multi)Polygon, in deg^2.
-- NULL for an empty geometry (territory_revisions_geom_not_empty rejects it).
CREATE FUNCTION geometry_min_part_area(g geometry) RETURNS double precision
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT min(ST_Area(part.geom)) FROM ST_Dump(g) AS part
  $$;

ALTER TABLE territory_revisions
  ADD CONSTRAINT territory_revisions_geom_parts_have_area
  CHECK (geometry_min_part_area(geom) > 1e-12);

-- Output helper: a one-part MultiPolygon is returned as its Polygon, a
-- multi-part one unchanged. Used by every query that emits territory
-- geometry, so the API contract is "Polygon for one part, MultiPolygon for
-- two or more" everywhere.
CREATE FUNCTION territory_geometry_unwrap(g geometry) RETURNS geometry
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT CASE WHEN ST_NumGeometries(g) = 1 THEN ST_GeometryN(g, 1) ELSE g END
  $$;
