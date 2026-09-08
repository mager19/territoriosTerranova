-- 0002: Core application schema.
--
-- Invariants modeled here (AGENTS.md):
--   * History is append-only. territory_revisions, progress_entries, and
--     audit_events are immutable — enforced by triggers, not conventions.
--   * Current state is derived: an assignment points at a specific geometry
--     revision; reopening preserves that reference and requires a reason.
--   * Geometry columns are SRID 4326 by typmod; invalid, empty, and
--     zero-area polygons are rejected by CHECK constraints. The database is
--     the last line of defense — application code validates earlier, but
--     these constraints hold even if application code is bypassed.

CREATE TYPE territory_status AS ENUM ('active', 'archived');
CREATE TYPE assignment_status AS ENUM ('active', 'completed', 'returned');

-- Territories: identity and lifecycle state only. Geometry lives in revisions.
CREATE TABLE territories (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,
  status      territory_status NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Territory revisions: one row per geometry version. Never updated, never
-- deleted. The current revision of a territory is derived as the row with
-- the highest revision_number.
CREATE TABLE territory_revisions (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  territory_id     bigint NOT NULL REFERENCES territories(id),
  revision_number  integer NOT NULL CHECK (revision_number > 0),
  geom             geometry(Polygon, 4326) NOT NULL,
  author           text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT territory_revisions_unique_number UNIQUE (territory_id, revision_number),
  -- Redundant on purpose: enables the composite foreign key from assignments
  -- that guarantees an assignment's revision belongs to its territory.
  CONSTRAINT territory_revisions_territory_key UNIQUE (territory_id, id),
  CONSTRAINT territory_revisions_geom_valid CHECK (ST_IsValid(geom)),
  CONSTRAINT territory_revisions_geom_not_empty CHECK (NOT ST_IsEmpty(geom)),
  -- Zero-area rejection with a measured epsilon: degenerate rings (e.g.
  -- collinear vertices) are ST_IsValid=true and leave shoelace-formula
  -- residue <= ~2.2e-17 deg^2 (measured on PostGIS 3.4, spans up to 0.1 deg),
  -- while any real parcel is >= ~1e-8 deg^2. 1e-12 deg^2 (~1.2 cm^2 at Bello's
  -- latitude) separates both by 4-5 orders of magnitude. ST_Area(geography)
  -- is NOT usable here: geodesic edges turn degree-collinear rings into
  -- slivers measuring thousands of m^2 (measured: 4457 m^2 for a 0.1 deg span).
  CONSTRAINT territory_revisions_geom_has_area CHECK (ST_Area(geom) > 1e-12)
);

CREATE INDEX territory_revisions_geom_idx ON territory_revisions USING gist (geom);

-- Shared immutability enforcer for append-only tables.
CREATE FUNCTION reject_row_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER territory_revisions_immutable
  BEFORE UPDATE OR DELETE ON territory_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TRIGGER territory_revisions_no_truncate
  BEFORE TRUNCATE ON territory_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_row_mutation();

-- Assignments: reference a specific territory_revision, not just a territory.
CREATE TABLE assignments (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  territory_id           bigint NOT NULL,
  territory_revision_id  bigint NOT NULL,
  CONSTRAINT assignments_revision_belongs_to_territory
    FOREIGN KEY (territory_id, territory_revision_id)
    REFERENCES territory_revisions (territory_id, id),
  assigned_to            text NOT NULL,
  assigned_by            text NOT NULL,
  status                 assignment_status NOT NULL DEFAULT 'active',
  assigned_at            timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,
  returned_at            timestamptz,
  reopen_reason          text,
  CONSTRAINT assignments_completed_has_timestamp CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  CONSTRAINT assignments_returned_has_timestamp CHECK (status <> 'returned' OR returned_at IS NOT NULL)
);

CREATE INDEX assignments_territory_idx ON assignments (territory_id);

-- At most one active assignment per territory. A partial UNIQUE index (not a
-- trigger) makes this hold under concurrent transactions: the second writer
-- blocks on the index until the first commits, then fails with 23505.
CREATE UNIQUE INDEX assignments_one_active_per_territory
  ON assignments (territory_id)
  WHERE status = 'active';

-- Reopening requires an auditable reason (AGENTS.md). The reason lives on the
-- row for enforcement; A3 mirrors every transition into audit_events.
CREATE FUNCTION enforce_reopen_reason() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('completed', 'returned')
     AND NEW.status = 'active'
     AND (NEW.reopen_reason IS NULL OR btrim(NEW.reopen_reason) = '') THEN
    RAISE EXCEPTION 'reopening assignment % requires a reopen_reason', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assignments_reopen_reason
  BEFORE UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_reopen_reason();

-- Progress entries: append-only. Optional pause point, route, and
-- remaining-area geometry. A NULL remaining_area means UNKNOWN — never
-- "the rest of the territory" (AGENTS.md: do not infer remaining).
CREATE TABLE progress_entries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assignment_id   bigint NOT NULL REFERENCES assignments(id),
  recorded_by     text NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  note            text,
  pause_point     geometry(Point, 4326),
  route           geometry(LineString, 4326),
  remaining_area  geometry(Geometry, 4326),
  CONSTRAINT progress_entries_pause_point_valid
    CHECK (pause_point IS NULL OR (ST_IsValid(pause_point) AND NOT ST_IsEmpty(pause_point))),
  CONSTRAINT progress_entries_route_valid
    CHECK (route IS NULL OR (ST_IsValid(route) AND NOT ST_IsEmpty(route))),
  CONSTRAINT progress_entries_remaining_area_valid
    CHECK (remaining_area IS NULL OR (
      ST_GeometryType(remaining_area) IN ('ST_Polygon', 'ST_MultiPolygon')
      AND ST_IsValid(remaining_area)
      AND NOT ST_IsEmpty(remaining_area)
      -- Same measured epsilon as territory_revisions_geom_has_area.
      AND ST_Area(remaining_area) > 1e-12
    ))
);

CREATE INDEX progress_entries_assignment_idx ON progress_entries (assignment_id);

CREATE TRIGGER progress_entries_immutable
  BEFORE UPDATE OR DELETE ON progress_entries
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TRIGGER progress_entries_no_truncate
  BEFORE TRUNCATE ON progress_entries
  FOR EACH STATEMENT EXECUTE FUNCTION reject_row_mutation();

-- Audit events: append-only record of every state transition, with actor and
-- reason. reason is NOT NULL: a transition without a stated reason is a
-- transition nobody can defend later.
CREATE TABLE audit_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type  text NOT NULL,
  entity_id    bigint NOT NULL,
  action       text NOT NULL,
  actor        text NOT NULL,
  reason       text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id, created_at);

CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_row_mutation();

-- Share tokens: A4 owns the logic, A2 owns the table. Only a hash of the
-- token is ever stored — there is deliberately no plaintext column. A token
-- is a scoped public bearer secret for one assignment, never an admin
-- principal (AGENTS.md).
CREATE TABLE share_tokens (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assignment_id  bigint NOT NULL REFERENCES assignments(id),
  token_hash     text NOT NULL UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz,
  revoked_at     timestamptz,
  CONSTRAINT share_tokens_expiry_after_creation CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT share_tokens_revocation_after_creation CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX share_tokens_assignment_idx ON share_tokens (assignment_id);
