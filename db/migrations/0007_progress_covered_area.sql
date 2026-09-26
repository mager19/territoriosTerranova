-- 0007: Coverage sessions — the area COVERED in one session.
--
-- 2026-09-26 product decision: each session the administrator draws the area
-- the group covered that day (it may end mid-block, so there is no fixed
-- block grid). The server derives the new remaining area as
--   previous remaining area of the CURRENT cycle  MINUS  covered area
-- and stores both on the same immutable progress entry. Pause point and route
-- stay optional evidence.
--
-- Invariants modeled here (AGENTS.md):
--   * progress_entries stays append-only: adding columns does not touch the
--     existing progress_entries_immutable / progress_entries_no_truncate
--     triggers, and no existing row is rewritten.
--   * covered_area is nullable: rows recorded before this migration (and any
--     legacy remaining-area-only entry) remain valid with covered_area NULL.
--   * covered_area follows the same geometry rules as remaining_area (0002):
--     SRID 4326 by typmod, Polygon/MultiPolygon only, valid, non-empty, and
--     above the measured 1e-12 deg^2 zero-area epsilon.
--
-- "Nothing left" representation (the load-bearing choice of this migration):
--   A NULL remaining_area still means UNKNOWN (0002; AGENTS.md: never infer
--   remaining coverage from the territory polygon). When a session's covered
--   area consumes ALL of the remaining area, the entry stores an explicit
--   EMPTY polygon (POLYGON EMPTY, SRID 4326) — "0% left" — never NULL. The
--   remaining-area CHECK is therefore relaxed to accept an empty polygon,
--   but ONLY on a coverage session (covered_area IS NOT NULL): no other
--   writer can record "nothing left" without the covered area that proves it.
--   The constraint keeps its original name so existing error mapping holds.
--
-- baseline records, immutably, how the FIRST coverage session of a cycle got
-- its starting remaining area when none existed yet: 'whole_territory' means
-- the administrator explicitly confirmed "start from the whole territory".
-- It is never set implicitly; without it (and without a prior remaining area
-- in the cycle) the application rejects the session.

ALTER TABLE progress_entries ADD COLUMN covered_area geometry(Geometry, 4326);
ALTER TABLE progress_entries ADD COLUMN baseline text;

ALTER TABLE progress_entries ADD CONSTRAINT progress_entries_covered_area_valid
  CHECK (covered_area IS NULL OR (
    ST_GeometryType(covered_area) IN ('ST_Polygon', 'ST_MultiPolygon')
    AND ST_IsValid(covered_area)
    AND NOT ST_IsEmpty(covered_area)
    -- Same measured epsilon as territory_revisions_geom_has_area (0002).
    AND ST_Area(covered_area) > 1e-12
  ));

-- A coverage session always leaves an explicit remaining area (possibly the
-- empty polygon): its result is never "unknown".
ALTER TABLE progress_entries ADD CONSTRAINT progress_entries_covered_area_has_remaining
  CHECK (covered_area IS NULL OR remaining_area IS NOT NULL);

ALTER TABLE progress_entries ADD CONSTRAINT progress_entries_baseline_valid
  CHECK (baseline IS NULL OR (baseline = 'whole_territory' AND covered_area IS NOT NULL));

ALTER TABLE progress_entries DROP CONSTRAINT progress_entries_remaining_area_valid;
ALTER TABLE progress_entries ADD CONSTRAINT progress_entries_remaining_area_valid
  CHECK (remaining_area IS NULL OR (
    ST_GeometryType(remaining_area) IN ('ST_Polygon', 'ST_MultiPolygon')
    AND ST_IsValid(remaining_area)
    AND (
      (NOT ST_IsEmpty(remaining_area) AND ST_Area(remaining_area) > 1e-12)
      -- Explicit "0% left": only a coverage session may record it.
      OR (ST_IsEmpty(remaining_area) AND covered_area IS NOT NULL)
    )
  ));
