import { describe, expect, it } from 'vitest';

import { sortByTerritoryName } from './sort.js';

const named = (...names: string[]) => names.map((name, index) => ({ id: index + 1, name }));

describe('sortByTerritoryName', () => {
  it('orders numbers inside names naturally, so NV-2 comes before NV-10', () => {
    const sorted = sortByTerritoryName(named('NV-10', 'NV-2', 'NV-01', 'NV-03'));

    expect(sorted.map((t) => t.name)).toEqual(['NV-01', 'NV-2', 'NV-03', 'NV-10']);
  });

  it('ignores case and accents like a Spanish reader would', () => {
    const sorted = sortByTerritoryName(named('niquía', 'Navarra', 'NIQUIA 2', 'acevedo'));

    expect(sorted.map((t) => t.name)).toEqual(['acevedo', 'Navarra', 'niquía', 'NIQUIA 2']);
  });

  it('returns a new array and leaves the input untouched', () => {
    const input = named('B', 'A');
    const sorted = sortByTerritoryName(input);

    expect(sorted).not.toBe(input);
    expect(input.map((t) => t.name)).toEqual(['B', 'A']);
  });
});
