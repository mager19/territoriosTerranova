// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultiPolygon, Polygon } from '@territorios/geo';

import type { ReferenceBarrio, TerritoryListItem, TerritoryWithRevisions } from '../../api/client.js';
import { TerritoryEditor } from './TerritoryEditor.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (event: { point: { x: number; y: number }; preventDefault: () => void }) => void;

/**
 * A MapLibre stand-in that fires `load` immediately and lets the test click
 * the map: unproject maps a screen pixel (x, y) to [x / 1000 - 75.6, y / 1000 + 6.3].
 */
const mapState = vi.hoisted(() => ({
  handlers: new Map<string, Set<Handler>>(),
  setData: [] as { source: string; data: unknown }[],
  renderedFeatures: [] as { properties: Record<string, unknown> }[]
}));

vi.mock('maplibre-gl', () => ({
  Map: class {
    on(type: string, handler: Handler): void {
      if (type === 'load') {
        queueMicrotask(() => handler({ point: { x: 0, y: 0 }, preventDefault: () => undefined }));
        return;
      }
      const set = mapState.handlers.get(type) ?? new Set<Handler>();
      set.add(handler);
      mapState.handlers.set(type, set);
    }
    off(type: string, handler: Handler): void {
      mapState.handlers.get(type)?.delete(handler);
    }
    addSource(): void {}
    addLayer(): void {}
    addControl(): void {}
    getSource(source: string) {
      return { setData: (data: unknown) => mapState.setData.push({ source, data }) };
    }
    fitBounds(): void {}
    unproject([x, y]: [number, number]) {
      return { lng: x / 1000 - 75.6, lat: y / 1000 + 6.3 };
    }
    project([lng, lat]: [number, number]) {
      return { x: (lng + 75.6) * 1000, y: (lat - 6.3) * 1000 };
    }
    queryRenderedFeatures() {
      return mapState.renderedFeatures;
    }
    doubleClickZoom = { disable: () => undefined, enable: () => undefined };
    dragPan = { disable: () => undefined, enable: () => undefined };
    getCanvas() {
      return { style: { cursor: '' } };
    }
    setStyle(): void {}
  },
  NavigationControl: class {}
}));

const listTerritories = vi.hoisted(() => vi.fn());
const searchReferenceBarrios = vi.hoisted(() => vi.fn());

vi.mock('../../api/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/client.js')>();
  return { ...original, listTerritories, searchReferenceBarrios };
});

/** Inverse of the mock's projection: the exact coordinate a screen pixel unprojects to. */
function at(x: number, y: number): [number, number] {
  return [x / 1000 - 75.6, y / 1000 + 6.3];
}

function square(x0: number, y0: number, size: number): Polygon {
  return {
    type: 'Polygon',
    coordinates: [[at(x0, y0), at(x0 + size, y0), at(x0 + size, y0 + size), at(x0, y0 + size), at(x0, y0)]]
  };
}

/** The territory being edited: screen (300,300)-(360,360). */
const EDITED_GEOMETRY = square(300, 300, 60);
/** A neighbouring territory: screen (100,100)-(160,160). */
const NEIGHBOR_GEOMETRY = square(100, 100, 60);
/** The reference barrio: a MultiPolygon, second part at screen (500,500)-(560,560). */
const BARRIO_GEOMETRY: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [square(700, 700, 60).coordinates, square(500, 500, 60).coordinates]
};

const selectedTerritory: TerritoryWithRevisions = {
  id: 1,
  name: 'Guasimalito 1',
  number: null,
  status: 'active',
  createdAt: '2026-09-21T00:00:00.000Z',
  revisions: [
    {
      id: 1,
      territoryId: 1,
      revisionNumber: 1,
      geometry: EDITED_GEOMETRY,
      author: 'admin',
      createdAt: '2026-09-21T00:00:00.000Z'
    }
  ]
};

function listItem(id: number, geometry: Polygon): TerritoryListItem {
  return {
    id,
    name: `T${id}`,
    number: null,
    status: 'active',
    createdAt: '2026-09-21T00:00:00.000Z',
    currentRevisionNumber: 1,
    geometry,
    operationalState: 'no_record'
  };
}

const barrio: ReferenceBarrio = {
  id: 9,
  name: 'Guasimalito',
  geometry: BARRIO_GEOMETRY,
  extensionKm2: 1.2,
  population: null
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  mapState.handlers.clear();
  mapState.setData.length = 0;
  mapState.renderedFeatures = [];
  listTerritories.mockReset();
  listTerritories.mockResolvedValue({ territories: [listItem(1, EDITED_GEOMETRY), listItem(2, NEIGHBOR_GEOMETRY)] });
  searchReferenceBarrios.mockReset();
  searchReferenceBarrios.mockResolvedValue({ barrios: [barrio] });
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
  }
  host?.remove();
  root = null;
  host = null;
});

function buttonByText(text: string): HTMLButtonElement {
  const button = [...(host?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Could not find button: ${text}`);
  return button;
}

async function renderEditor(territory: TerritoryWithRevisions | null): Promise<void> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<TerritoryEditor selectedTerritory={territory} onSaved={() => undefined} />);
  });
  // Let the mocked `load` microtask and the territory-list promise settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function fireMap(type: string, x: number, y: number): Promise<void> {
  await act(async () => {
    for (const handler of mapState.handlers.get(type) ?? []) {
      handler({ point: { x, y }, preventDefault: () => undefined });
    }
  });
}

type FeatureData = { features: { properties: Record<string, unknown> | null; geometry: { type: string; coordinates: unknown } }[] };

function lastData(source: string): FeatureData {
  const entries = mapState.setData.filter((entry) => entry.source === source);
  const last = entries[entries.length - 1];
  if (!last) throw new Error(`No data was set on source ${source}`);
  return last.data as FeatureData;
}

function draftVertices(): unknown[] {
  return lastData('draft-territory')
    .features.filter((feature) => feature.geometry.type === 'Point')
    .map((feature) => feature.geometry.coordinates);
}

async function selectBarrio(): Promise<void> {
  const input = host?.querySelector('#barrio-search');
  if (!(input instanceof HTMLInputElement)) throw new Error('Could not find the barrio search');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Guasi');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // The search is debounced by 250 ms.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  await act(async () => buttonByText('Guasimalito1.20 km²').click());
}

describe('TerritoryEditor', () => {
  it('leaves vertex editing without discarding the current draft geometry', async () => {
    await renderEditor(selectedTerritory);

    await act(async () => buttonByText('Editar forma actual').click());
    expect(buttonByText('Terminar edición de vértices').getAttribute('aria-pressed')).toBe('true');

    await act(async () => buttonByText('Terminar edición de vértices').click());

    expect(buttonByText('Editar vértices').getAttribute('aria-pressed')).toBe('false');
    expect(buttonByText('Guardar nueva revisión').disabled).toBe(false);
    expect(host?.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('4 punto(s) ubicado(s)');
  });

  describe('snapping to neighbouring territories and the reference barrio (2026-10-03)', () => {
    it('snaps a click near another territory vertex exactly onto it', async () => {
      await renderEditor(null);

      await fireMap('click', 105, 104);

      expect(draftVertices()).toEqual([NEIGHBOR_GEOMETRY.coordinates[0]![0]]);
    });

    it('snaps a click near another territory edge onto that edge', async () => {
      await renderEditor(null);

      await fireMap('click', 130, 96);

      const [vertex] = draftVertices() as [number, number][];
      expect(vertex![0]).toBeCloseTo(at(130, 100)[0], 12);
      expect(vertex![1]).toBeCloseTo(at(130, 100)[1], 12);
    });

    it('never snaps to the territory being edited, only to its neighbours', async () => {
      await renderEditor(selectedTerritory);

      // 4 px from the edited territory's own (300,300) corner: no snap, the raw point is used.
      await fireMap('click', 303, 303);
      await fireMap('click', 104, 104);

      expect(draftVertices()).toEqual([at(303, 303), NEIGHBOR_GEOMETRY.coordinates[0]![0]]);
    });

    it('draws the other territories as a reference outline, excluding the one being edited', async () => {
      await renderEditor(selectedTerritory);

      const neighbors = lastData('neighbor-territories').features.map((feature) => feature.geometry);
      expect(neighbors).toEqual([NEIGHBOR_GEOMETRY]);
    });

    it('snaps to a vertex of the selected reference barrio (any MultiPolygon part)', async () => {
      await renderEditor(null);
      await selectBarrio();

      await fireMap('click', 563, 562);

      expect(draftVertices()).toEqual([at(560, 560)]);
    });

    it('shows the snap ring while hovering within tolerance and hides it otherwise', async () => {
      await renderEditor(null);

      await fireMap('mousemove', 158, 163);
      expect(lastData('snap-indicator').features.map((feature) => feature.geometry.coordinates)).toEqual([at(160, 160)]);

      await fireMap('mousemove', 230, 230);
      expect(lastData('snap-indicator').features).toHaveLength(0);
    });

    it('snaps a dragged vertex in "edit vertices" mode', async () => {
      await renderEditor(selectedTerritory);
      await act(async () => buttonByText('Editar forma actual').click());

      mapState.renderedFeatures = [{ properties: { index: 0 } }];
      await fireMap('mousedown', 300, 300);
      mapState.renderedFeatures = [];
      await fireMap('mousemove', 164, 158);

      expect(lastData('snap-indicator').features).toHaveLength(1);
      expect(draftVertices()[0]).toEqual(at(160, 160));

      await fireMap('mouseup', 164, 158);
      expect(lastData('snap-indicator').features).toHaveLength(0);
    });

    it('keeps drawing without snapping when the territory list fails to load', async () => {
      listTerritories.mockRejectedValue(new Error('network down'));
      await renderEditor(null);

      await fireMap('click', 104, 104);

      expect(draftVertices()).toEqual([at(104, 104)]);
      expect(host?.textContent).toContain('No se pudieron cargar los otros territorios');
    });
  });
});
