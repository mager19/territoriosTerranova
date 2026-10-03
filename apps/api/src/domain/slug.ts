/**
 * Readable, fixed public URL slugs for territories (2026-10-03 product
 * decision, AGENTS.md "Privacy rules"): the public share view lives at
 * `/t/<slug>`, e.g. `/t/nv-01`.
 *
 * This is the ONE normalization in TypeScript. db/migrations/0011's
 * `territory_slug_base(text)` mirrors it in SQL for the backfill and for
 * rows inserted without a slug; integration/territory-slugs.test.ts pins
 * the two against each other. Uniqueness (`-2`, `-3`, … suffixes) is
 * decided in the database by `territory_next_free_slug(text)`, under a
 * transaction-scoped advisory lock, so concurrent creates never race.
 *
 * Slugs are stable: assigned once at creation and never recomputed, so a
 * link already sent to volunteers keeps working. (There is no rename
 * route today; if one is added, it must leave `slug` untouched.)
 */

export const SLUG_MAX_LENGTH = 60;
export const SLUG_FALLBACK = 'territorio';

export function territorySlugBase(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
  return slug === '' ? SLUG_FALLBACK : slug;
}
