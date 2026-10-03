-- 0008: Reopening a territory no longer requires a reason.
--
-- 2026-10-03 product decision: a territory is explicitly OPENED, progress is
-- recorded while it is open, and it is then CLOSED; the administrator later
-- decides when to open it again (a new cycle). Opening again is a routine
-- action, so the reason becomes optional and is stored as NULL when absent.
--
-- Only the CHECK constraint is dropped. territory_operational_events stays
-- append-only (the immutable / no-truncate triggers from 0006 are untouched)
-- and no existing row is rewritten. Every transition is still written to the
-- audit history by the application.

ALTER TABLE territory_operational_events
  DROP CONSTRAINT territory_operational_events_reopen_reason;
