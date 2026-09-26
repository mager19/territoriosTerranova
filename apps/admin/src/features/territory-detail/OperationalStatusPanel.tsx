import { useEffect, useState, type JSX } from 'react';

import {
  ApiError,
  DEFAULT_ACTOR,
  changeTerritoryOperationalState,
  describeApiError,
  getTerritoryOperationalStatus,
  type OperationalState,
  type TerritoryOperationalStatus
} from '../../api/client.js';
import { formatProgressPercent, isNothingRemaining } from './sessions.js';

const STATUS_LABELS: Record<OperationalState, string> = {
  no_record: 'Sin registro operativo',
  in_progress: 'En progreso',
  paused: 'Pausado',
  cycle_completed: 'Ciclo completado',
  reopened: 'Reabierto — en progreso'
};

export interface OperationalStatusPanelProps {
  readonly territoryId: number;
  readonly refreshToken: number;
  readonly onChanged: () => void;
  readonly onRemainingAreaChange: (status: TerritoryOperationalStatus) => void;
}

/**
 * Approximate progress of the current cycle (server-derived from geodesic
 * areas). Unknown is shown as "desconocido" with an empty, dashed track —
 * never as 0 %, which would claim that nothing was covered.
 */
export function ProgressMeter({ percent }: { readonly percent: number | null }): JSX.Element {
  const label = formatProgressPercent(percent);
  const width = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  return (
    <div className="progress-meter">
      <div
        role="progressbar"
        aria-label="Avance aproximado del ciclo"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent === null ? undefined : Math.floor(width)}
        aria-valuetext={label}
        className={`progress-meter-track${percent === null ? ' progress-meter-track--unknown' : ''}`}
      >
        <div className="progress-meter-fill" style={{ width: `${width}%` }} />
      </div>
      <span className="progress-meter-label">Avance aproximado: {label}</span>
    </div>
  );
}

/** The primary administrative workflow: current cycle state and pending coverage. */
export function OperationalStatusPanel({
  territoryId,
  refreshToken,
  onChanged,
  onRemainingAreaChange
}: OperationalStatusPanelProps): JSX.Element {
  const [status, setStatus] = useState<TerritoryOperationalStatus | null>(null);
  const [reason, setReason] = useState('');
  const [completionDate, setCompletionDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTerritoryOperationalStatus(territoryId)
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        onRemainingAreaChange(next);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudo cargar el estado operativo.');
      });
    return () => {
      cancelled = true;
    };
  }, [territoryId, refreshToken, onRemainingAreaChange]);

  async function change(action: Exclude<OperationalState, 'no_record'>): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const next = await changeTerritoryOperationalState(territoryId, {
        action,
        actor: DEFAULT_ACTOR,
        ...(action === 'reopened' ? { reason } : {}),
        ...(action === 'cycle_completed' ? { effectiveCompletionDate: completionDate } : {})
      });
      setStatus(next);
      setReason('');
      onRemainingAreaChange(next);
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudo actualizar el estado operativo.');
    } finally {
      setSaving(false);
    }
  }

  const state = status?.state ?? 'no_record';
  return (
    <section aria-labelledby="operational-status-heading">
      <h3 id="operational-status-heading">Cobertura y estado operativo</h3>
      {!status && !error && <p role="status">Cargando estado operativo…</p>}
      {status && (
        <>
          <p><strong>{STATUS_LABELS[state]}</strong>{status.cycleNumber === null ? '' : ` · ciclo ${status.cycleNumber}`}</p>
          <ProgressMeter percent={status.progressPercent} />
          <p>
            Área pendiente:{' '}
            {status.remainingAreaStatus === 'unknown' ? (
              <strong>desconocida.</strong>
            ) : isNothingRemaining(status.remainingArea) ? (
              'no queda nada pendiente en este ciclo.'
            ) : (
              'registrada y visible en el mapa.'
            )}
          </p>
          {status.effectiveCompletionDate && <p>Fecha efectiva de finalización: {status.effectiveCompletionDate}.</p>}
        </>
      )}
      {error && <p role="alert" className="editor-error">{error}</p>}
      {state === 'no_record' && <button type="button" onClick={() => void change('in_progress')} disabled={saving}>Abrir ciclo de trabajo</button>}
      {(state === 'in_progress' || state === 'reopened') && (
        <div className="operational-actions">
          <button type="button" onClick={() => void change('paused')} disabled={saving}>Pausar trabajo</button>
          <label htmlFor="completion-date">Fecha efectiva de finalización</label>
          <input id="completion-date" type="date" value={completionDate} onChange={(event) => setCompletionDate(event.target.value)} />
          <button type="button" className="primary" onClick={() => void change('cycle_completed')} disabled={saving || completionDate === ''}>Marcar ciclo como completado</button>
        </div>
      )}
      {state === 'paused' && (
        <div className="operational-actions">
          <button type="button" className="primary" onClick={() => void change('in_progress')} disabled={saving}>Reanudar trabajo</button>
          <label htmlFor="completion-date">Fecha efectiva de finalización</label>
          <input id="completion-date" type="date" value={completionDate} onChange={(event) => setCompletionDate(event.target.value)} />
          <button type="button" onClick={() => void change('cycle_completed')} disabled={saving || completionDate === ''}>Marcar ciclo como completado</button>
        </div>
      )}
      {state === 'cycle_completed' && (
        <div className="operational-actions">
          <label htmlFor="reopen-reason">Motivo para reabrir</label>
          <input id="reopen-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          <button type="button" className="primary" onClick={() => void change('reopened')} disabled={saving || reason.trim() === ''}>Reabrir ciclo</button>
        </div>
      )}
    </section>
  );
}
