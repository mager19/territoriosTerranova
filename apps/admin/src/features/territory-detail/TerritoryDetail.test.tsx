// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TerritoryCycle, TerritoryOperationalStatus } from '../../api/client.js';
import { TerritoryDetail } from './TerritoryDetail.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  getTerritoryOperationalStatus: vi.fn(),
  changeTerritoryOperationalState: vi.fn(),
  listProgress: vi.fn(),
  listTerritoryCycles: vi.fn()
}));

vi.mock('../../api/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/client.js')>();
  return { ...original, ...api };
});

// The recorder's map is covered by ProgressRecorder.test.tsx; here only its presence matters.
vi.mock('./ProgressRecorder.js', () => ({
  ProgressRecorder: () => <section data-testid="progress-recorder">Registrar sesión</section>
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function status(overrides: Partial<TerritoryOperationalStatus>): TerritoryOperationalStatus {
  return {
    state: 'in_progress',
    cycleNumber: 1,
    effectiveCompletionDate: null,
    remainingArea: null,
    remainingAreaStatus: 'unknown',
    progressPercent: null,
    ...overrides
  };
}

const OPEN_CYCLE: TerritoryCycle = {
  cycleNumber: 1,
  openedAt: '2026-10-03T15:00:00.000Z',
  closedAt: null,
  effectiveCompletionDate: null,
  sessionCount: 2
};

beforeEach(() => {
  api.listProgress.mockResolvedValue({ entries: [] });
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
  }
  host?.remove();
  root = null;
  host = null;
  for (const mock of Object.values(api)) mock.mockReset();
});

async function renderDetail(initial: TerritoryOperationalStatus, cycles: readonly TerritoryCycle[]): Promise<void> {
  api.getTerritoryOperationalStatus.mockResolvedValue(initial);
  api.listTerritoryCycles.mockResolvedValue({ cycles });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <TerritoryDetail territoryId={1} boundary={null} refreshToken={0} onRemainingAreaChange={() => undefined} onEdit={() => undefined} />
    );
  });
}

function recorder(): Element | null {
  return host?.querySelector('[data-testid="progress-recorder"]') ?? null;
}

describe('TerritoryDetail', () => {
  it('renders the recorder only while the territory is open', async () => {
    await renderDetail(status({ state: 'in_progress' }), [OPEN_CYCLE]);
    expect(recorder()).not.toBeNull();
    expect(host?.textContent).not.toContain('Ábrelo para registrar progreso');
  });

  it('replaces the recorder with a message when the territory is closed', async () => {
    await renderDetail(status({ state: 'cycle_completed', effectiveCompletionDate: '2026-10-10' }), [
      { ...OPEN_CYCLE, closedAt: '2026-10-10T20:00:00.000Z', effectiveCompletionDate: '2026-10-10' }
    ]);
    expect(recorder()).toBeNull();
    expect(host?.textContent).toContain('El territorio está cerrado. Ábrelo para registrar progreso.');
  });

  it('asks to open a territory that was never opened before recording', async () => {
    await renderDetail(status({ state: 'no_record', cycleNumber: null }), []);
    expect(recorder()).toBeNull();
    expect(host?.textContent).toContain('Abre el territorio para empezar a registrar progreso.');
  });

  it('places the status bar with "Compartir" right under the heading, before the recorder and the cycle history', async () => {
    await renderDetail(status({ state: 'in_progress' }), [OPEN_CYCLE]);
    const text = host?.textContent ?? '';
    expect(text).not.toContain('Cobertura y estado operativo');
    const editLink = text.indexOf('Editar mapa');
    const bar = text.indexOf('Abierto desde el 3 oct 2026');
    const shareButton = text.indexOf('Compartir');
    const recorderAt = text.indexOf('Registrar sesión');
    const sessionsAt = text.indexOf('Sesiones');
    const cyclesAt = text.indexOf('Historial de ciclos');
    expect(editLink).toBeGreaterThan(-1);
    expect(bar).toBeGreaterThan(editLink);
    expect(shareButton).toBeGreaterThan(editLink);
    expect(shareButton).toBeLessThan(recorderAt);
    expect(cyclesAt).toBeGreaterThan(sessionsAt);
    expect(text).not.toContain('Historial de auditoría');
    expect(text).toContain('Ciclo 1 · abierto 3 oct 2026 · en curso · 2 sesiones');
  });

  it('refreshes the cycle history and shows the recorder after opening the territory', async () => {
    await renderDetail(status({ state: 'no_record', cycleNumber: null }), []);
    api.changeTerritoryOperationalState.mockResolvedValue(status({ state: 'in_progress' }));
    api.getTerritoryOperationalStatus.mockResolvedValue(status({ state: 'in_progress' }));
    api.listTerritoryCycles.mockResolvedValue({ cycles: [{ ...OPEN_CYCLE, sessionCount: 0 }] });

    const open = [...(host?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === 'Abrir territorio');
    await act(async () => open?.click());

    expect(api.listTerritoryCycles).toHaveBeenCalledTimes(2);
    expect(recorder()).not.toBeNull();
    expect(host?.textContent).toContain('Ciclo 1 · abierto 3 oct 2026 · en curso · sin sesiones');
  });
});
