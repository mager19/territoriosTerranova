import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { TerritoryCycle } from '../../api/client.js';
import { CycleHistory } from './CycleHistory.js';

const CYCLES: readonly TerritoryCycle[] = [
  { cycleNumber: 2, openedAt: '2026-10-15T15:00:00.000Z', closedAt: null, effectiveCompletionDate: null, sessionCount: 3 },
  {
    cycleNumber: 1,
    openedAt: '2026-10-03T15:00:00.000Z',
    closedAt: '2026-10-10T20:00:00.000Z',
    effectiveCompletionDate: '2026-10-10',
    sessionCount: 5
  }
];

describe('CycleHistory', () => {
  it('lists every cycle newest first with its open and close dates and session count', () => {
    const html = renderToStaticMarkup(<CycleHistory cycles={CYCLES} loading={false} error={null} />);
    expect(html).toContain('Historial de ciclos');
    const second = html.indexOf('Ciclo 2 · abierto 15 oct 2026 · en curso · 3 sesiones');
    const first = html.indexOf('Ciclo 1 · abierto 3 oct 2026 – cerrado 10 oct 2026 · 5 sesiones');
    expect(second).toBeGreaterThan(-1);
    expect(first).toBeGreaterThan(second);
  });

  it('says when the territory has never been opened', () => {
    const html = renderToStaticMarkup(<CycleHistory cycles={[]} loading={false} error={null} />);
    expect(html).toContain('Este territorio todavía no se ha abierto.');
  });

  it('shows loading and error states', () => {
    expect(renderToStaticMarkup(<CycleHistory cycles={[]} loading error={null} />)).toContain('Cargando ciclos…');
    expect(renderToStaticMarkup(<CycleHistory cycles={[]} loading={false} error="Sin conexión" />)).toContain(
      'role="alert"'
    );
  });
});
