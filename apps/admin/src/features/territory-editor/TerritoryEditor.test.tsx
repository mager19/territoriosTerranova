// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TerritoryWithRevisions } from '../../api/client.js';
import { TerritoryEditor } from './TerritoryEditor.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('maplibre-gl', () => ({
  Map: class {
    addControl(): void {}
    on(): void {}
    setStyle(): void {}
  },
  NavigationControl: class {}
}));

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
      geometry: {
        type: 'Polygon',
        coordinates: [[[-75.55, 6.34], [-75.54, 6.34], [-75.54, 6.35], [-75.55, 6.34]]]
      },
      author: 'admin',
      createdAt: '2026-09-21T00:00:00.000Z'
    }
  ]
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

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

describe('TerritoryEditor', () => {
  it('leaves vertex editing without discarding the current draft geometry', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(<TerritoryEditor selectedTerritory={selectedTerritory} onSaved={() => undefined} />);
    });

    await act(async () => buttonByText('Editar forma actual').click());
    expect(buttonByText('Terminar edición de vértices').getAttribute('aria-pressed')).toBe('true');

    await act(async () => buttonByText('Terminar edición de vértices').click());

    expect(buttonByText('Editar vértices').getAttribute('aria-pressed')).toBe('false');
    expect(buttonByText('Guardar nueva revisión').disabled).toBe(false);
    expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('3 punto(s) ubicado(s)');
  });
});
