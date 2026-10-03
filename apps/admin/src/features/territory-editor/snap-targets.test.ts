import { describe, expect, it } from 'vitest';
import type { MultiPolygon, Polygon } from '@territorios/geo';

import type { TerritoryListItem } from '../../api/client.js';
import { editorSnapTargets, neighborTerritoryGeometries } from './snap-targets.js';

function square(x: number): Polygon {
  return { type: 'Polygon', coordinates: [[[x, 0], [x + 0.01, 0], [x + 0.01, 0.01], [x, 0.01], [x, 0]]] };
}

function item(id: number, geometry: Polygon | null): TerritoryListItem {
  return {
    id,
    name: `T${id}`,
    slug: `t${id}`,
    number: null,
    status: 'active',
    createdAt: '2026-10-03T00:00:00.000Z',
    currentRevisionNumber: geometry === null ? 0 : 1,
    geometry,
    operationalState: 'no_record'
  };
}

const BARRIO: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [[[0.1, 0], [0.12, 0], [0.12, 0.02], [0.1, 0]]],
    [[[0.2, 0], [0.22, 0], [0.22, 0.02], [0.2, 0]]]
  ]
};

describe('neighborTerritoryGeometries', () => {
  it('returns nothing until the territory list has loaded (or when it failed)', () => {
    expect(neighborTerritoryGeometries(null, 1)).toEqual([]);
  });

  it('excludes the territory being edited and territories without a revision', () => {
    const list = [item(1, square(0)), item(2, square(0.02)), item(3, null), item(4, square(0.04))];
    expect(neighborTerritoryGeometries(list, 2)).toEqual([square(0), square(0.04)]);
  });

  it('keeps every territory with geometry when drawing a new one', () => {
    const list = [item(1, square(0)), item(2, square(0.02))];
    expect(neighborTerritoryGeometries(list, null)).toEqual([square(0), square(0.02)]);
  });
});

describe('editorSnapTargets', () => {
  it('combines neighbouring territories with the selected reference barrio (MultiPolygon kept intact)', () => {
    const list = [item(1, square(0)), item(2, square(0.02))];
    expect(editorSnapTargets(list, 1, BARRIO)).toEqual([square(0.02), BARRIO]);
  });

  it('uses only the barrio while the list is not loaded, and nothing without either', () => {
    expect(editorSnapTargets(null, null, BARRIO)).toEqual([BARRIO]);
    expect(editorSnapTargets(null, null, null)).toEqual([]);
  });
});
