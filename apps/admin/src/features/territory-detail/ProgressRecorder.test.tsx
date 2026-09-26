// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, type RecordSessionInput } from '../../api/client.js';
import { ProgressRecorder } from './ProgressRecorder.js';

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
  setData: [] as { source: string; data: unknown }[]
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
      return [];
    }
    doubleClickZoom = { disable: () => undefined, enable: () => undefined };
    dragPan = { disable: () => undefined, enable: () => undefined };
    getCanvas() {
      return { style: { cursor: '' } };
    }
  },
  NavigationControl: class {}
}));

const recordProgress = vi.hoisted(() => vi.fn());

vi.mock('../../api/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/client.js')>();
  return { ...original, recordProgress };
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  mapState.handlers.clear();
  mapState.setData.length = 0;
  recordProgress.mockReset();
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

async function clickMap(x: number, y: number): Promise<void> {
  await act(async () => {
    for (const handler of mapState.handlers.get('click') ?? []) {
      handler({ point: { x, y }, preventDefault: () => undefined });
    }
  });
}

async function renderRecorder(onRecorded: () => void = () => undefined): Promise<void> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<ProgressRecorder territoryId={7} boundary={null} onRecorded={onRecorded} />);
  });
  // Let the mocked `load` microtask install layers and mark the map ready.
  await act(async () => {
    await Promise.resolve();
  });
}

async function drawClosedCoveredArea(): Promise<void> {
  await act(async () => buttonByText('Dibujar área cubierta').click());
  await clickMap(26, 57);
  await clickMap(27, 57);
  await clickMap(27, 58);
  await act(async () => buttonByText('Cerrar área cubierta').click());
}

describe('ProgressRecorder', () => {
  it('centers the session on the covered area, keeps pause point and route as optional tools, and asks for no actor', () => {
    const html = renderToStaticMarkup(<ProgressRecorder territoryId={1} boundary={null} onRecorded={() => undefined} />);

    expect(html).toContain('Registrar sesión');
    expect(html).toContain('aria-label="Herramientas de la sesión"');
    expect(html).toContain('Dibujar área cubierta');
    expect(html).toContain('Cerrar área cubierta');
    expect(html).toContain('Editar vértices del área');
    expect(html).toContain('Dibujar ruta');
    expect(html).toContain('Colocar pausa');
    expect(html).toContain('Cancelar sesión');
    expect(html).not.toContain('área pendiente</button>');
    expect(html).not.toContain('progress-recorded-by');
  });

  it('cannot save a session until the covered area is drawn and closed', async () => {
    await renderRecorder();
    expect(buttonByText('Guardar sesión').disabled).toBe(true);

    await act(async () => buttonByText('Dibujar área cubierta').click());
    await clickMap(26, 57);
    await clickMap(27, 57);
    await clickMap(27, 58);
    expect(buttonByText('Guardar sesión').disabled).toBe(true);

    await act(async () => buttonByText('Cerrar área cubierta').click());
    expect(buttonByText('Guardar sesión').disabled).toBe(false);
  });

  it('sends only the covered area plus optional evidence — never a remaining area', async () => {
    recordProgress.mockResolvedValue({});
    const onRecorded = vi.fn();
    await renderRecorder(onRecorded);
    await drawClosedCoveredArea();

    await act(async () => buttonByText('Colocar pausa').click());
    await clickMap(26, 57);

    await act(async () => buttonByText('Guardar sesión').click());

    expect(recordProgress).toHaveBeenCalledTimes(1);
    const [territoryId, request] = recordProgress.mock.calls[0] as [number, RecordSessionInput];
    expect(territoryId).toBe(7);
    expect(request.coveredArea.type).toBe('Polygon');
    expect(request.coveredArea.coordinates[0]).toHaveLength(4);
    expect(request.pausePoint?.type).toBe('Point');
    expect(request).not.toHaveProperty('remainingArea');
    expect(request).not.toHaveProperty('baseline');
    expect(onRecorded).toHaveBeenCalledTimes(1);
  });

  it('turns baseline_required into an in-page confirmation and resends with the explicit baseline only after "yes"', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    recordProgress
      .mockRejectedValueOnce(new ApiError(400, 'baseline_required', 'confirm the baseline'))
      .mockResolvedValueOnce({});
    const onRecorded = vi.fn();
    await renderRecorder(onRecorded);
    await drawClosedCoveredArea();

    await act(async () => buttonByText('Guardar sesión').click());

    const prompt = host?.querySelector('[role="alertdialog"]');
    expect(prompt?.textContent).toContain('Este ciclo todavía no tiene un área pendiente registrada.');
    expect(host?.querySelector('[role="alert"]')).toBeNull();
    expect(buttonByText('Guardar sesión').disabled).toBe(true);
    expect(onRecorded).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();

    await act(async () => buttonByText('Sí, partir de todo el territorio').click());

    expect(recordProgress).toHaveBeenCalledTimes(2);
    const retried = recordProgress.mock.calls[1]?.[1] as RecordSessionInput;
    expect(retried.baseline).toBe('whole_territory');
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(host?.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('dismissing the baseline prompt records nothing and keeps the drawing', async () => {
    recordProgress.mockRejectedValueOnce(new ApiError(400, 'baseline_required', 'confirm the baseline'));
    await renderRecorder();
    await drawClosedCoveredArea();
    await act(async () => buttonByText('Guardar sesión').click());

    await act(async () => buttonByText('No, cancelar').click());

    expect(recordProgress).toHaveBeenCalledTimes(1);
    expect(host?.querySelector('[role="alertdialog"]')).toBeNull();
    expect(buttonByText('Guardar sesión').disabled).toBe(false);
  });

  it('explains an out-of-territory rejection in terms of the territory, not the municipal boundary', async () => {
    recordProgress.mockRejectedValueOnce(new ApiError(400, 'out_of_bounds', 'covered-area geometry must lie within'));
    await renderRecorder();
    await drawClosedCoveredArea();
    await act(async () => buttonByText('Guardar sesión').click());

    expect(host?.querySelector('[role="alert"]')?.textContent).toContain('fuera del territorio');
  });

  it('keeps the covered area and the route as separate drafts — drawing a route does not touch the covered area', async () => {
    recordProgress.mockResolvedValue({});
    await renderRecorder();
    await drawClosedCoveredArea();

    await act(async () => buttonByText('Dibujar ruta').click());
    await clickMap(26, 57);
    await clickMap(27, 58);
    await act(async () => buttonByText('Guardar sesión').click());

    const request = recordProgress.mock.calls[0]?.[1] as RecordSessionInput;
    expect(request.coveredArea.coordinates[0]).toHaveLength(4);
    expect(request.route?.coordinates).toHaveLength(2);
  });
});
