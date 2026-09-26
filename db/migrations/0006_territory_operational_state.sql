-- 0006: Append-only operational state for repeatable territory work cycles.
--
-- A territory's geometry lifecycle (active/archived) remains separate from its
-- operational work lifecycle. The latter is derived from the latest immutable
-- event, so completing or reopening a cycle never overwrites its history.

CREATE TYPE territory_operational_action AS ENUM (
  'in_progress',
  'paused',
  'cycle_completed',
  'reopened'
);

CREATE TABLE territory_operational_events (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  territory_id              bigint NOT NULL REFERENCES territories(id),
  cycle_number              integer NOT NULL CHECK (cycle_number > 0),
  action                    territory_operational_action NOT NULL,
  actor                     text NOT NULL,
  reason                    text,
  effective_completion_date date,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT territory_operational_events_completion_date
    CHECK ((action = 'cycle_completed') = (effective_completion_date IS NOT NULL)),
  CONSTRAINT territory_operational_events_reopen_reason
    CHECK (action <> 'reopened' OR (reason IS NOT NULL AND btrim(reason) <> ''))
);

CREATE INDEX territory_operational_events_current_idx
  ON territory_operational_events (territory_id, id DESC);

CREATE TRIGGER territory_operational_events_immutable
  BEFORE UPDATE OR DELETE ON territory_operational_events
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TRIGGER territory_operational_events_no_truncate
  BEFORE TRUNCATE ON territory_operational_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_row_mutation();
