-- 0011: Readable, fixed public URL slugs for territories.
--
-- 2026-10-03 product decision (AGENTS.md "Privacy rules"): the public share
-- view moves from opaque token links (`/#<token>`) to fixed URLs
-- `/t/<slug>`, e.g. `/t/nv-01`. Slugs are guessable by design; the user
-- accepted that trade-off (small volunteer group, public data carries no
-- personal information, read-only).
--
-- Normalization mirrors apps/api/src/domain/slug.ts (territorySlugBase):
-- NFD, strip combining marks, lowercase, every run of non [a-z0-9] -> '-',
-- trim '-', at most 60 characters (no trailing '-' after the cut), and
-- 'territorio' when nothing is left. apps/api/src/integration/
-- territory-slugs.test.ts pins the SQL and TypeScript versions together.
--
-- Uniqueness: territory_next_free_slug(base) returns base, or base-2,
-- base-3, ... — the first one no territory has — under a transaction-scoped
-- advisory lock, so concurrent creations serialize instead of racing. The
-- unique constraint is the backstop.
--
-- Stability: a slug is assigned once and never changes, so a link already
-- sent to volunteers keeps working (a rename, if one is ever added, keeps
-- the slug). territories_slug_immutable enforces it.
--
-- Safe against the existing BEFORE UPDATE trigger on territories
-- (territories_overlap_on_reactivation, 0003): it fires only when status
-- changes to 'active', so the backfill UPDATE below does not re-run the
-- overlap check. territories itself has no append-only trigger.

CREATE FUNCTION territory_slug_base(name text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT COALESCE(
    NULLIF(
      regexp_replace(
        left(
          regexp_replace(
            regexp_replace(
              lower(
                regexp_replace(
                  normalize(name, NFD),
                  '[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]',
                  '',
                  'g'
                )
              ),
              '[^a-z0-9]+', '-', 'g'
            ),
            '^-+|-+$', '', 'g'
          ),
          60
        ),
        '-+$', ''
      ),
      ''
    ),
    'territorio'
  )
$$;

CREATE FUNCTION territory_next_free_slug(base text) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  candidate text := base;
  suffix integer := 1;
BEGIN
  -- Held until the calling transaction ends, so the territory it inserts is
  -- committed (and visible to the next caller's fresh snapshot) first.
  PERFORM pg_advisory_xact_lock(hashtext('territories.slug'));
  WHILE EXISTS (SELECT 1 FROM territories WHERE slug = candidate) LOOP
    suffix := suffix + 1;
    candidate := base || '-' || suffix;
  END LOOP;
  RETURN candidate;
END;
$$;

ALTER TABLE territories ADD COLUMN slug text;

-- Backfill in id order, so the oldest territory keeps the bare slug and the
-- dedupe suffixes are deterministic.
DO $$
DECLARE
  territory record;
BEGIN
  FOR territory IN SELECT id, name FROM territories ORDER BY id LOOP
    UPDATE territories
    SET slug = territory_next_free_slug(territory_slug_base(territory.name))
    WHERE id = territory.id;
  END LOOP;
END;
$$;

ALTER TABLE territories ALTER COLUMN slug SET NOT NULL;
ALTER TABLE territories ADD CONSTRAINT territories_slug_unique UNIQUE (slug);
ALTER TABLE territories ADD CONSTRAINT territories_slug_format
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80);

-- The API always supplies a slug (domain/territories.ts); this fills it for
-- any other insert path, with the same normalization and uniqueness rule.
CREATE FUNCTION assign_territory_slug() RETURNS trigger AS $$
BEGIN
  NEW.slug := territory_next_free_slug(territory_slug_base(NEW.name));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER territories_assign_slug
  BEFORE INSERT ON territories
  FOR EACH ROW
  WHEN (NEW.slug IS NULL)
  EXECUTE FUNCTION assign_territory_slug();

CREATE FUNCTION reject_territory_slug_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'territory % slug is immutable (shared links depend on it)', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER territories_slug_immutable
  BEFORE UPDATE OF slug ON territories
  FOR EACH ROW
  WHEN (OLD.slug IS DISTINCT FROM NEW.slug)
  EXECUTE FUNCTION reject_territory_slug_change();
