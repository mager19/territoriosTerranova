/**
 * Pure helpers for the AMVA reference-barrio autocomplete — no MapLibre, no
 * DOM, no fetch. Kept separate from the component so the parts that can be
 * tested in Node (area formatting, keyboard highlight movement) are tested
 * in Node, while the debounce and map interactions stay in the component
 * where they belong.
 */

/**
 * Formats an area in km² to two decimals, or an empty string when unknown.
 * `extensionKm2` is nullable on the wire (a barrio may not have a recorded
 * extension), so the empty case is a real state, not an edge case.
 */
export function formatKm2(extensionKm2: number | null): string {
  if (extensionKm2 === null) return '';
  return `${extensionKm2.toFixed(2)} km²`;
}

/**
 * Moves the highlighted combobox option by one step, clamped to the list
 * bounds (never wraps). `-1` means "nothing highlighted" (e.g. the dropdown
 * just opened); moving down from `-1` highlights the first option. An empty
 * list always returns `-1` — there is nothing to highlight.
 */
export function nextActiveIndex(current: number, move: 'down' | 'up', count: number): number {
  if (count <= 0) return -1;
  if (move === 'down') {
    return current < 0 ? 0 : Math.min(current + 1, count - 1);
  }
  return current <= 0 ? 0 : current - 1;
}
