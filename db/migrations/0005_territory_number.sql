-- 0005: The congregation's own territory number.
--
-- Nullable because territories created before this migration have no number
-- and one cannot be invented for them; they read as "—" until an
-- administrator assigns one. Postgres allows multiple NULLs under a UNIQUE
-- constraint, so un-numbered territories coexist.
--
-- text, not integer, so codes like 'N-04' remain possible. Callers order by
-- (length(number), number) to keep plain numbers in natural order.
--
-- Safe against the existing BEFORE UPDATE trigger on territories
-- (territories_overlap_on_reactivation, 0003): that trigger's WHEN clause
-- fires only when status changes to 'active', so writing a number does not
-- re-run the overlap check.

ALTER TABLE territories ADD COLUMN number text;

ALTER TABLE territories ADD CONSTRAINT territories_number_unique UNIQUE (number);
