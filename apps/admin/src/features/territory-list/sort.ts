/**
 * Territory list order (2026-10-03): by name, the way a Spanish reader
 * expects. `numeric` makes digit runs compare as numbers (NV-2 before
 * NV-10); base sensitivity ignores case and accents (niquía = NIQUIA).
 * The API keeps returning creation order; sorting is a display concern.
 */
const NAME_COLLATOR = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

export function sortByTerritoryName<T extends { readonly id: number; readonly name: string }>(
  territories: readonly T[]
): T[] {
  // Equal names (e.g. "niquía" vs "NIQUIA") keep a stable order by id.
  return [...territories].sort((a, b) => NAME_COLLATOR.compare(a.name, b.name) || a.id - b.id);
}
