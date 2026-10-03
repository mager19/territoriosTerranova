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

function hasButton(text: string): boolean {
  return [...(host?.querySelectorAll('button') ?? [])].some((candidate) => candidate.textContent === text);
}

function statusText(): string {
  return host?.querySelector('[role="status"]')?.textContent ?? '';
}

function noteField(): HTMLTextAreaElement {
  const field = host?.querySelector('#progress-note');
  if (!(field instanceof HTMLTextAreaElement)) throw new Error('Could not find the note field');
  return field;
}

async function typeNote(value: string): Promise<void> {
  await act(async () => {
    const field = noteField();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(text: string): Promise<void> {
  await act(async () => buttonByText(text).click());
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

/** No "start drawing" step: drawing is active as soon as the recorder mounts. */
async function drawClosedCoveredArea(): Promise<void> {
  await clickMap(26, 57);
  await clickMap(27, 57);
  await clickMap(27, 58);
  await click('Cerrar área');
}

describe('ProgressRecorder', () => {
  it('offers only the covered area and the note — no route, no pause point, no actor field', () => {
    const html = renderToStaticMarkup(<ProgressRecorder territoryId={1} boundary={null} onRecorded={() => undefined} />);

    expect(html).toContain('Registrar sesión');
    expect(html).toContain('Marca en el mapa lo que cubrieron en esta sesión. Lo que falta se calcula solo.');
    expect(html).toContain('Deshacer punto');
    expect(html).toContain('Cerrar área');
    expect(html).toContain('Guardar sesión');
    expect(html).toContain('Cancelar');
    expect(html).not.toMatch(/ruta|pausa|recorrido/i);
    expect(html).not.toContain('Dibujar');
    expect(html).not.toContain('progress-recorded-by');
  });

  it('uses neutral Spanish (tú), never voseo, in the recorder copy', () => {
    const html = renderToStaticMarkup(<ProgressRecorder territoryId={1} boundary={null} onRecorded={() => undefined} />);

    expect(html).not.toMatch(/Dibujá|Hacé|Marcá|Elegí|Editá|Agregá|Guardá|Arrastrá|Ajustá|Usá|Escribí/);
  });

  it('starts in drawing mode: map clicks add vertices without pressing any button first', async () => {
    await renderRecorder();
    expect(buttonByText('Deshacer punto').disabled).toBe(true);
    expect(buttonByText('Cerrar área').disabled).toBe(true);
    expect(statusText()).toContain('Haz clic en el mapa');

    await clickMap(26, 57);
    expect(buttonByText('Deshacer punto').disabled).toBe(false);
    expect(buttonByText('Cerrar área').disabled).toBe(true);

    await clickMap(27, 57);
    await clickMap(27, 58);
    expect(buttonByText('Cerrar área').disabled).toBe(false);
    expect(statusText()).toContain('Cerrar área');
  });

  it('"Deshacer punto" removes the last vertex', async () => {
    await renderRecorder();
    await clickMap(26, 57);
    await clickMap(27, 57);
    await clickMap(27, 58);

    await click('Deshacer punto');

    expect(buttonByText('Cerrar área').disabled).toBe(true);
  });

  it('cannot save a session until the covered area is closed', async () => {
    await renderRecorder();
    expect(buttonByText('Guardar sesión').disabled).toBe(true);

    await clickMap(26, 57);
    await clickMap(27, 57);
    await clickMap(27, 58);
    expect(buttonByText('Guardar sesión').disabled).toBe(true);
    expect(statusText()).not.toContain('lista');

    await click('Cerrar área');
    expect(buttonByText('Guardar sesión').disabled).toBe(false);
    expect(statusText()).toContain('Área lista');
  });

  it('once closed, swaps the drawing buttons for "Ajustar puntos" and "Borrar y volver a dibujar", and ignores further clicks', async () => {
    recordProgress.mockResolvedValue({});
    await renderRecorder();
    await drawClosedCoveredArea();

    expect(hasButton('Deshacer punto')).toBe(false);
    expect(hasButton('Cerrar área')).toBe(false);
    expect(hasButton('Ajustar puntos')).toBe(true);
    expect(hasButton('Borrar y volver a dibujar')).toBe(true);

    await clickMap(30, 60);
    await click('Guardar sesión');

    const request = recordProgress.mock.calls[0]?.[1] as RecordSessionInput;
    expect(request.coveredArea.coordinates[0]).toHaveLength(4);
  });

  it('"Ajustar puntos" toggles vertex editing — labeled "Listo" while active, with the gestures explained', async () => {
    await renderRecorder();
    await drawClosedCoveredArea();

    await click('Ajustar puntos');
    expect(buttonByText('Listo').getAttribute('aria-pressed')).toBe('true');
    expect(statusText()).toContain('Arrastra un punto');
    expect(statusText()).toContain('doble clic');

    await click('Listo');
    expect(buttonByText('Ajustar puntos').getAttribute('aria-pressed')).toBe('false');
    expect(statusText()).toContain('Área lista');
  });

  it('"Borrar y volver a dibujar" clears the area and returns to drawing mode', async () => {
    await renderRecorder();
    await drawClosedCoveredArea();

    await click('Borrar y volver a dibujar');

    expect(buttonByText('Guardar sesión').disabled).toBe(true);
    expect(buttonByText('Deshacer punto').disabled).toBe(true);
    await clickMap(26, 57);
    expect(buttonByText('Deshacer punto').disabled).toBe(false);
  });

  it('labels the note for the next group and warns, via aria-describedby, that it is visible through the share link', async () => {
    await renderRecorder();
    const field = noteField();
    const label = host?.querySelector('label[for="progress-note"]');

    expect(label?.textContent).toBe('Nota para el próximo grupo (opcional)');
    const helpId = field.getAttribute('aria-describedby');
    expect(helpId).toBeTruthy();
    const help = host?.querySelector(`#${helpId}`);
    expect(help?.textContent).toBe(
      'La verá quien tenga el enlace del territorio. Ej.: “Quedamos en la esquina de la Diagonal 57 con 19C”. No escribas nombres ni datos de personas.'
    );
  });

  it('sends only the covered area and the note — never a route, pause point, or remaining area', async () => {
    recordProgress.mockResolvedValue({});
    const onRecorded = vi.fn();
    await renderRecorder(onRecorded);
    await drawClosedCoveredArea();
    await typeNote('  Quedamos en la esquina  ');

    await click('Guardar sesión');

    expect(recordProgress).toHaveBeenCalledTimes(1);
    const [territoryId, request] = recordProgress.mock.calls[0] as [number, RecordSessionInput];
    expect(territoryId).toBe(7);
    expect(Object.keys(request).sort()).toEqual(['coveredArea', 'note', 'recordedBy']);
    expect(request.coveredArea.type).toBe('Polygon');
    expect(request.note).toBe('Quedamos en la esquina');
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(noteField().value).toBe('');
  });

  it('"Cancelar" is disabled until something is entered, then clears the drawing and the note', async () => {
    await renderRecorder();
    expect(buttonByText('Cancelar').disabled).toBe(true);

    await typeNote('algo');
    expect(buttonByText('Cancelar').disabled).toBe(false);
    await clickMap(26, 57);

    await click('Cancelar');

    expect(noteField().value).toBe('');
    expect(buttonByText('Deshacer punto').disabled).toBe(true);
    expect(buttonByText('Cancelar').disabled).toBe(true);
  });

  it('turns baseline_required into an in-page confirmation and resends with the explicit baseline only after "yes"', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    recordProgress
      .mockRejectedValueOnce(new ApiError(400, 'baseline_required', 'confirm the baseline'))
      .mockResolvedValueOnce({});
    const onRecorded = vi.fn();
    await renderRecorder(onRecorded);
    await drawClosedCoveredArea();

    await click('Guardar sesión');

    const prompt = host?.querySelector('[role="alertdialog"]');
    expect(prompt?.textContent).toContain('Este ciclo todavía no tiene un área pendiente registrada.');
    expect(host?.querySelector('[role="alert"]')).toBeNull();
    expect(buttonByText('Guardar sesión').disabled).toBe(true);
    expect(onRecorded).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();

    await click('Sí, partir de todo el territorio');

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
    await click('Guardar sesión');

    await click('No, cancelar');

    expect(recordProgress).toHaveBeenCalledTimes(1);
    expect(host?.querySelector('[role="alertdialog"]')).toBeNull();
    expect(buttonByText('Guardar sesión').disabled).toBe(false);
  });

  it('explains an out-of-territory rejection in terms of the territory, in neutral Spanish', async () => {
    recordProgress.mockRejectedValueOnce(new ApiError(400, 'out_of_bounds', 'covered-area geometry must lie within'));
    await renderRecorder();
    await drawClosedCoveredArea();
    await click('Guardar sesión');

    const alert = host?.querySelector('[role="alert"]')?.textContent ?? '';
    expect(alert).toContain('fuera del territorio');
    expect(alert).toContain('Ajusta los puntos');
  });
});
