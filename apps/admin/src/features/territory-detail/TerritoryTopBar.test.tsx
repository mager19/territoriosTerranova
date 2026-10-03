// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TerritoryCycle, TerritoryOperationalStatus } from '../../api/client.js';
import { TerritoryTopBar } from './TerritoryTopBar.js';
import { localCalendarDate } from './cycles.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getTerritoryOperationalStatus = vi.hoisted(() => vi.fn());
const changeTerritoryOperationalState = vi.hoisted(() => vi.fn());

vi.mock('../../api/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/client.js')>();
  return { ...original, getTerritoryOperationalStatus, changeTerritoryOperationalState };
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
  }
  host?.remove();
  root = null;
  host = null;
  getTerritoryOperationalStatus.mockReset();
  changeTerritoryOperationalState.mockReset();
});

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

const CYCLE_1: TerritoryCycle = {
  cycleNumber: 1,
  openedAt: '2026-10-03T15:00:00.000Z',
  closedAt: null,
  effectiveCompletionDate: null,
  sessionCount: 0
};

interface Rendered {
  readonly onChanged: ReturnType<typeof vi.fn>;
  readonly onStatus: ReturnType<typeof vi.fn>;
}

async function renderBar(initial: TerritoryOperationalStatus, cycles: readonly TerritoryCycle[] = [CYCLE_1]): Promise<Rendered> {
  getTerritoryOperationalStatus.mockResolvedValue(initial);
  const onChanged = vi.fn();
  const onStatus = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <TerritoryTopBar territoryId={7} refreshToken={0} cycles={cycles} onChanged={onChanged} onStatus={onStatus} />
    );
  });
  return { onChanged, onStatus };
}

function button(label: string): HTMLButtonElement | undefined {
  return [...(host?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === label);
}

describe('TerritoryTopBar', () => {
  it('offers "Abrir territorio" on a territory that was never opened and opens it without a reason', async () => {
    const { onChanged, onStatus } = await renderBar(status({ state: 'no_record', cycleNumber: null }), []);
    expect(host?.textContent).toContain('Sin abrir');
    expect(button('Cerrar territorio')).toBeUndefined();

    const opened = status({ state: 'in_progress', cycleNumber: 1 });
    changeTerritoryOperationalState.mockResolvedValue(opened);
    await act(async () => button('Abrir territorio')?.click());

    expect(changeTerritoryOperationalState).toHaveBeenCalledWith(7, { action: 'in_progress', actor: 'admin' });
    expect(onStatus).toHaveBeenLastCalledWith(opened);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shows since when an open territory is open and closes it with today’s local date', async () => {
    const { onChanged } = await renderBar(status({ state: 'in_progress' }));
    expect(host?.textContent).toContain('Abierto desde el 3 oct 2026');
    expect(button('Abrir territorio')).toBeUndefined();

    changeTerritoryOperationalState.mockResolvedValue(status({ state: 'cycle_completed', effectiveCompletionDate: localCalendarDate(new Date()) }));
    await act(async () => button('Cerrar territorio')?.click());

    expect(changeTerritoryOperationalState).toHaveBeenCalledWith(7, {
      action: 'cycle_completed',
      actor: 'admin',
      effectiveCompletionDate: localCalendarDate(new Date())
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('treats a legacy paused cycle as open', async () => {
    await renderBar(status({ state: 'paused' }));
    expect(host?.textContent).toContain('Abierto desde el 3 oct 2026');
    expect(button('Cerrar territorio')).toBeDefined();
    expect(host?.textContent).not.toContain('Reanudar');
  });

  it('reopens a closed territory as a new cycle without asking for a reason', async () => {
    await renderBar(status({ state: 'cycle_completed', effectiveCompletionDate: '2026-10-10' }));
    expect(host?.textContent).toContain('Cerrado el 10 oct 2026');
    expect(host?.querySelector('input')).toBeNull();

    changeTerritoryOperationalState.mockResolvedValue(status({ state: 'reopened', cycleNumber: 2 }));
    await act(async () => button('Abrir territorio')?.click());

    expect(changeTerritoryOperationalState).toHaveBeenCalledWith(7, { action: 'reopened', actor: 'admin' });
  });

  it('no longer shows the progress meter, pause controls, completion date, or reopen reason', async () => {
    await renderBar(status({ state: 'in_progress', progressPercent: 40 }));
    const text = host?.textContent ?? '';
    expect(text).not.toContain('Avance aproximado');
    expect(text).not.toContain('Pausar trabajo');
    expect(text).not.toContain('Fecha efectiva');
    expect(text).not.toContain('Motivo');
    expect(host?.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('reveals the share panel inline from the "Compartir" button', async () => {
    await renderBar(status({ state: 'in_progress' }));
    const share = button('Compartir');
    expect(share?.getAttribute('aria-expanded')).toBe('false');
    expect(button('Compartir este territorio')).toBeUndefined();

    await act(async () => share?.click());
    expect(share?.getAttribute('aria-expanded')).toBe('true');
    expect(button('Compartir este territorio')).toBeDefined();
  });

  it('surfaces a failed change as an alert instead of changing state', async () => {
    const { onChanged } = await renderBar(status({ state: 'in_progress' }));
    const { ApiError } = await import('../../api/client.js');
    changeTerritoryOperationalState.mockRejectedValue(new ApiError(400, 'invalid_request', 'cannot change'));
    await act(async () => button('Cerrar territorio')?.click());

    expect(host?.querySelector('[role="alert"]')?.textContent).toBe('Faltan datos o el formato no es válido.');
    expect(onChanged).not.toHaveBeenCalled();
    expect(host?.textContent).toContain('Abierto desde el 3 oct 2026');
  });
});
