import { useEffect, useState, type JSX } from 'react';

import {
  ApiError,
  DEFAULT_ACTOR,
  changeTerritoryOperationalState,
  describeApiError,
  getTerritoryOperationalStatus,
  type TerritoryCycle,
  type TerritoryOperationalStatus
} from '../../api/client.js';
import { describeTopBarStatus, isOpenState, localCalendarDate } from './cycles.js';
import { SharePanel } from './SharePanel.js';

export interface TerritoryTopBarProps {
  readonly territoryId: number;
  readonly refreshToken: number;
  /** Newest first; the current cycle's opening date comes from here. */
  readonly cycles: readonly TerritoryCycle[];
  /** Called after a successful open/close so the rest of the page refreshes. */
  readonly onChanged: () => void;
  /** Every loaded or changed status — feeds the remaining area to the map and the cycle to session filtering. */
  readonly onStatus: (status: TerritoryOperationalStatus) => void;
}

const SHARE_REGION_ID = 'territory-share-region';

/**
 * The compact bar at the top of a territory (2026-10-03 product decision):
 * whether it is open, one state button, and sharing. The administrator
 * explicitly opens a territory ("Abrir territorio": no_record → in_progress,
 * or a closed cycle → reopened, which starts a new cycle — no reason asked)
 * and closes it ("Cerrar territorio": cycle_completed with today's local date).
 * A legacy paused cycle is shown and handled as open.
 */
export function TerritoryTopBar({ territoryId, refreshToken, cycles, onChanged, onStatus }: TerritoryTopBarProps): JSX.Element {
  const [status, setStatus] = useState<TerritoryOperationalStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // Mounted on first open and then only hidden, so links issued this session
  // (shown once, never fetchable again) survive collapsing the panel.
  const [shareMounted, setShareMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTerritoryOperationalStatus(territoryId)
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        onStatus(next);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudo cargar el estado del territorio.');
      });
    return () => {
      cancelled = true;
    };
  }, [territoryId, refreshToken, onStatus]);

  async function change(input: Parameters<typeof changeTerritoryOperationalState>[1]): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const next = await changeTerritoryOperationalState(territoryId, input);
      setStatus(next);
      onStatus(next);
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudo actualizar el estado del territorio.');
    } finally {
      setSaving(false);
    }
  }

  function open(): void {
    if (!status) return;
    void change({ action: status.state === 'cycle_completed' ? 'reopened' : 'in_progress', actor: DEFAULT_ACTOR });
  }

  function close(): void {
    void change({ action: 'cycle_completed', actor: DEFAULT_ACTOR, effectiveCompletionDate: localCalendarDate(new Date()) });
  }

  const isOpen = status !== null && isOpenState(status.state);
  return (
    <div className="territory-topbar-wrap">
      <div className="territory-topbar" role="region" aria-label="Estado del territorio">
        <p className="territory-topbar-status" role="status">
          {status === null ? (
            error ? 'Estado desconocido' : 'Cargando estado…'
          ) : (
            <>
              <span className={`territory-topbar-dot${isOpen ? ' territory-topbar-dot--open' : ''}`} aria-hidden="true" />
              {describeTopBarStatus(status, cycles)}
            </>
          )}
        </p>
        <div className="territory-topbar-actions">
          <button
            type="button"
            aria-expanded={shareOpen}
            aria-controls={SHARE_REGION_ID}
            onClick={() => {
              setShareMounted(true);
              setShareOpen((current) => !current);
            }}
          >
            Compartir
          </button>
          {status !== null &&
            (isOpen ? (
              <button type="button" onClick={close} disabled={saving}>
                Cerrar territorio
              </button>
            ) : (
              <button type="button" className="primary" onClick={open} disabled={saving}>
                Abrir territorio
              </button>
            ))}
        </div>
      </div>
      {error && <p role="alert" className="editor-error">{error}</p>}
      <div id={SHARE_REGION_ID} hidden={!shareOpen}>
        {shareMounted && <SharePanel territoryId={territoryId} />}
      </div>
    </div>
  );
}
