// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TerritoryOperationalStatus } from '../../api/client.js';
import { OperationalStatusPanel, ProgressMeter } from './OperationalStatusPanel.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getTerritoryOperationalStatus = vi.hoisted(() => vi.fn());

vi.mock('../../api/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/client.js')>();
  return { ...original, getTerritoryOperationalStatus };
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

async function renderPanel(next: TerritoryOperationalStatus): Promise<void> {
  getTerritoryOperationalStatus.mockResolvedValue(next);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <OperationalStatusPanel territoryId={1} refreshToken={0} onChanged={() => undefined} onRemainingAreaChange={() => undefined} />
    );
  });
}

describe('ProgressMeter', () => {
  it('fills the bar to the server-derived percentage and labels it', () => {
    const html = renderToStaticMarkup(<ProgressMeter percent={42.7} />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('width:42.7%');
    expect(html).toContain('Avance aproximado: 42 %');
  });

  it('shows "desconocido" — not 0 % — when progress is unknown', () => {
    const html = renderToStaticMarkup(<ProgressMeter percent={null} />);
    expect(html).toContain('Avance aproximado: desconocido');
    expect(html).toContain('aria-valuetext="desconocido"');
    expect(html).not.toContain('aria-valuenow');
    expect(html).toContain('progress-meter-track--unknown');
    expect(html).not.toContain('0 %');
  });
});

describe('OperationalStatusPanel', () => {
  it('reports an unknown remaining area and unknown progress', async () => {
    await renderPanel(status({}));
    expect(host?.textContent).toContain('Avance aproximado: desconocido');
    expect(host?.textContent).toContain('Área pendiente: desconocida.');
  });

  it('distinguishes a fully covered cycle (explicit empty remaining area) from unknown', async () => {
    await renderPanel(
      status({ remainingArea: { type: 'Polygon', coordinates: [] }, remainingAreaStatus: 'recorded', progressPercent: 100 })
    );
    expect(host?.textContent).toContain('Avance aproximado: 100 %');
    expect(host?.textContent).toContain('no queda nada pendiente en este ciclo');
  });
});
