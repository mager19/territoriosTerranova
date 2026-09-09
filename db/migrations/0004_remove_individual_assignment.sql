-- 0004: Remove individual assignment.
--
-- 2026-09-08 product decision: territories are shared to a whole group of
-- volunteers, not assigned to one named person. There is deliberately no
-- "responsible party" for the system to track, enforce, or require a
-- return/complete/reopen lifecycle for — a volunteer self-selects a shared
-- territory from the group, does what they can, and there is no minimum or
-- completion requirement.
--
-- Progress and share tokens now belong to the TERRITORY directly instead of
-- to a per-person claim. The public share link therefore always reflects
-- the territory's CURRENT (latest) revision and latest progress entry —
-- there is no more per-claim revision pin to keep in sync.
--
-- Local/demo data in progress_entries and share_tokens is discarded here
-- (progress_entries' append-only trigger is disabled only for this one-time
-- schema migration, then restored) rather than backfilled: there is no
-- production data yet, and there is no sound way to attribute an old
-- per-person progress entry to "the territory, shared to nobody in
-- particular" after the fact.

ALTER TABLE progress_entries DISABLE TRIGGER progress_entries_immutable;
ALTER TABLE progress_entries DISABLE TRIGGER progress_entries_no_truncate;
TRUNCATE progress_entries;
ALTER TABLE progress_entries ENABLE TRIGGER progress_entries_immutable;
ALTER TABLE progress_entries ENABLE TRIGGER progress_entries_no_truncate;

TRUNCATE share_tokens;

ALTER TABLE progress_entries DROP COLUMN assignment_id;
ALTER TABLE progress_entries ADD COLUMN territory_id bigint NOT NULL REFERENCES territories(id);
CREATE INDEX progress_entries_territory_idx ON progress_entries (territory_id);

ALTER TABLE share_tokens DROP COLUMN assignment_id;
ALTER TABLE share_tokens ADD COLUMN territory_id bigint NOT NULL REFERENCES territories(id);
CREATE INDEX share_tokens_territory_idx ON share_tokens (territory_id);

DROP TABLE assignments;
DROP FUNCTION IF EXISTS enforce_reopen_reason();
DROP TYPE assignment_status;
