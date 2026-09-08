-- 0003: Spatial constraints and AMVA reference tables.
--
-- The database is the last line of defense (AGENTS.md):
--   * every territory revision must be contained by the Bello municipal
--     boundary — and the check FAILS CLOSED when the boundary reference is
--     not loaded;
--   * active territories must not overlap each other (true area conflict:
--     interiors intersect; merely touching neighbours are allowed), unless an
--     explicit authorized exception exists;
--   * the overlap check holds under concurrent transactions via a
--     transaction-scoped advisory lock that serializes geometry writers,
--     closing the READ COMMITTED hole where two uncommitted overlapping
--     revisions would each pass the check.
--
-- The reference_* tables hold AMVA drafting-reference data (POT 2009 vintage,
-- (c) 2017 Area Metropolitana del Valle de Aburra). They are admin-only
-- reference: never expose their attributes or source URLs on public paths.

CREATE TABLE reference_municipal_boundary (
  id            integer PRIMARY KEY CHECK (id = 1), -- singleton
  name          text NOT NULL,
  geom          geometry(MultiPolygon, 4326) NOT NULL,
  source_url    text NOT NULL,
  retrieved_at  timestamptz NOT NULL,
  attribution   text NOT NULL,
  CONSTRAINT boundary_geom_valid CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom))
);

CREATE TABLE reference_barrios (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre                text NOT NULL,
  codigo_pot            text,
  codigo_dane           text,
  codigo_catastro       text,
  cod_comuna            text,
  extension_km2         double precision,
  poblacion_2004        double precision,
  estrato_predominante  text,
  geom                  geometry(MultiPolygon, 4326) NOT NULL,
  source_url            text NOT NULL,
  retrieved_at          timestamptz NOT NULL,
  attribution           text NOT NULL,
  CONSTRAINT barrios_geom_valid CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom))
);

CREATE INDEX reference_barrios_geom_idx ON reference_barrios USING gist (geom);

-- Containment against the municipal boundary. AFTER (not BEFORE) so column
-- CHECK constraints reject invalid geometry first, keeping error attribution
-- clean. Fails closed: without the boundary reference nothing may be inserted.
CREATE FUNCTION enforce_territory_containment() RETURNS trigger AS $$
DECLARE
  boundary geometry;
BEGIN
  SELECT geom INTO boundary FROM reference_municipal_boundary WHERE id = 1;
  IF boundary IS NULL THEN
    RAISE EXCEPTION 'municipal boundary reference not loaded; run the AMVA seed before creating territory revisions';
  END IF;
  IF NOT ST_Within(NEW.geom, boundary) THEN
    RAISE EXCEPTION 'territory revision % is not contained by the Bello municipal boundary', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER territory_revisions_contained
  AFTER INSERT ON territory_revisions
  FOR EACH ROW EXECUTE FUNCTION enforce_territory_containment();

-- Explicit authorized-exception path for overlaps. Canonical ordering
-- (a < b) makes each pair unique. WHO may authorize and HOW exceptions are
-- reviewed is an open orchestrator decision (docs/agents/README.md, "Still
-- open"); this table is the mechanical path only.
CREATE TABLE territory_overlap_exceptions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  territory_a_id  bigint NOT NULL REFERENCES territories(id),
  territory_b_id  bigint NOT NULL REFERENCES territories(id),
  authorized_by   text NOT NULL,
  reason          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT overlap_exception_pair_ordered CHECK (territory_a_id < territory_b_id),
  CONSTRAINT overlap_exception_pair_unique UNIQUE (territory_a_id, territory_b_id)
);

-- Finds one active territory whose current revision (highest revision_number)
-- truly overlaps the given geometry. True overlap = interiors intersect:
-- ST_Intersects AND NOT ST_Touches, so adjacent territories sharing a border
-- are allowed while containment/partial overlap are not.
CREATE FUNCTION find_active_overlap(
  p_territory_id bigint,
  p_geom geometry,
  OUT conflict_id bigint,
  OUT conflict_name text
) RETURNS record AS $$
  SELECT t.id, t.name
  FROM territories t
  JOIN LATERAL (
    SELECT r.geom
    FROM territory_revisions r
    WHERE r.territory_id = t.id
    ORDER BY r.revision_number DESC
    LIMIT 1
  ) current_geom ON TRUE
  WHERE t.status = 'active'
    AND t.id <> p_territory_id
    AND ST_Intersects(current_geom.geom, p_geom)
    AND NOT ST_Touches(current_geom.geom, p_geom)
    AND NOT EXISTS (
      SELECT 1 FROM territory_overlap_exceptions e
      WHERE e.territory_a_id = LEAST(t.id, p_territory_id)
        AND e.territory_b_id = GREATEST(t.id, p_territory_id)
    )
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Overlap enforcement on every new revision of an active territory.
-- Lock key 7420001 is the project-wide geometry-serialization lock.
CREATE FUNCTION enforce_territory_overlap() RETURNS trigger AS $$
DECLARE
  conflict_id   bigint;
  conflict_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM territories WHERE id = NEW.territory_id AND status = 'active'
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(7420001);

  SELECT c.conflict_id, c.conflict_name
    INTO conflict_id, conflict_name
  FROM find_active_overlap(NEW.territory_id, NEW.geom) AS c;

  IF conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'territory revision % overlaps active territory % (%) without an authorized exception',
      NEW.id, conflict_id, conflict_name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER territory_revisions_no_overlap
  AFTER INSERT ON territory_revisions
  FOR EACH ROW EXECUTE FUNCTION enforce_territory_overlap();

-- Reactivating an archived territory re-runs the overlap check against its
-- latest revision; otherwise archive-then-reactivate would be a bypass hole.
CREATE FUNCTION enforce_overlap_on_reactivation() RETURNS trigger AS $$
DECLARE
  current_geom  geometry;
  conflict_id   bigint;
  conflict_name text;
BEGIN
  SELECT r.geom INTO current_geom
  FROM territory_revisions r
  WHERE r.territory_id = NEW.id
  ORDER BY r.revision_number DESC
  LIMIT 1;

  IF current_geom IS NULL THEN
    RETURN NEW; -- no geometry yet: nothing can overlap
  END IF;

  PERFORM pg_advisory_xact_lock(7420001);

  SELECT c.conflict_id, c.conflict_name
    INTO conflict_id, conflict_name
  FROM find_active_overlap(NEW.id, current_geom) AS c;

  IF conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'territory % (%) overlaps active territory % (%) without an authorized exception',
      NEW.id, NEW.name, conflict_id, conflict_name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER territories_overlap_on_reactivation
  BEFORE UPDATE ON territories
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'active')
  EXECUTE FUNCTION enforce_overlap_on_reactivation();
