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
          <p>
            Área pendiente: {status.remainingAreaStatus === 'recorded' ? 'registrada y visible en el mapa.' : <strong>desconocida.</strong>}
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
