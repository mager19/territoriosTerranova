import type { JSX } from 'react';

import type { TerritoryCycle } from '../../api/client.js';
import { describeCycle } from './cycles.js';

export interface CycleHistoryProps {
  /** Newest first, as returned by GET /admin/territories/:id/cycles. */
  readonly cycles: readonly TerritoryCycle[];
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * Every opening and closing of the territory (2026-10-03), newest first.
 * Read-only: each row is derived from immutable operational events, so the
 * open and close dates of every cycle stay visible in the record.
 */
export function CycleHistory({ cycles, loading, error }: CycleHistoryProps): JSX.Element {
  return (
    <section aria-labelledby="cycle-history-heading">
      <h3 id="cycle-history-heading">Historial de ciclos</h3>
      {loading && cycles.length === 0 && <p role="status">Cargando ciclos…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && cycles.length === 0 && <p>Este territorio todavía no se ha abierto.</p>}
      {cycles.length > 0 && (
        <ol className="cycle-history">
          {cycles.map((cycle) => (
            <li key={cycle.cycleNumber} className={cycle.closedAt === null ? 'cycle-history-item--open' : undefined}>
              {describeCycle(cycle)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
