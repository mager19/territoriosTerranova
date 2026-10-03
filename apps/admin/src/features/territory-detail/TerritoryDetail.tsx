import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import {
  ApiError,
  describeApiError,
  listProgress,
  listTerritoryCycles,
  type ProgressEntry,
  type TerritoryCycle,
  type TerritoryOperationalStatus
} from '../../api/client.js';
import { CycleHistory } from './CycleHistory.js';
import { isOpenState } from './cycles.js';
import { ProgressList } from './ProgressList.js';
import { ProgressRecorder } from './ProgressRecorder.js';
import { TerritoryTopBar } from './TerritoryTopBar.js';
import { currentCycleSessions } from './sessions.js';
import type { TerritoryGeometry } from '@territorios/geo';

export interface TerritoryDetailProps {
  readonly territoryId: number;
  /** Fixed public slug, for the share panel's `/t/<slug>` link. */
  readonly slug: string;
  readonly boundary: TerritoryGeometry | null;
  readonly refreshToken: number;
  /** Forwarded up to App so the map (TerritoryEditor) can render it as an overlay. */
  readonly onRemainingAreaChange: (geometry: ProgressEntry['remainingArea']) => void;
  /** Navigate to this territory's editor route (`/territorios/:id/editar`). */
  readonly onEdit: () => void;
}

/**
 * Composes the selected territory: the top bar (open/closed status, the
 * open/close action, and sharing — 2026-10-03), the session recorder (only
 * while the territory is open), recorded sessions, and the cycle history.
 * The audit trail is no longer shown here (2026-10-03: the cycle history
 * covers what administrators need); it stays stored and served by the API.
 * Simpler than its
 * A5-original shape (2026-09-08: territories are shared to a group, not
 * assigned to one person) — progress and cycle history are always
 * territory-scoped now, so they need only the same `refreshToken` the
 * parent already passes, plus a local `progressVersion` bumped when
 * ProgressRecorder saves (there is no more assignment-derived version
 * counter to thread through — the equivalent A5-original plumbing this
 * replaces).
 */
export function TerritoryDetail({ territoryId, slug, boundary, refreshToken, onRemainingAreaChange, onEdit }: TerritoryDetailProps): JSX.Element {
  const [progressVersion, setProgressVersion] = useState(0);
  const combinedRefreshToken = refreshToken + progressVersion;
  const [status, setStatus] = useState<TerritoryOperationalStatus | null>(null);
  const [entries, setEntries] = useState<readonly ProgressEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  // Hover previews a session on the map; a click pins it until clicked again.
  const [hoveredSessionId, setHoveredSessionId] = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [cycles, setCycles] = useState<readonly TerritoryCycle[]>([]);
  const [cyclesLoading, setCyclesLoading] = useState(false);
  const [cyclesError, setCyclesError] = useState<string | null>(null);

  // One load feeds both the session list and the recorder map, so the
  // colors and numbers in the list always match the map.
  useEffect(() => {
    let cancelled = false;
    setEntriesLoading(true);
    setEntriesError(null);
    listProgress(territoryId)
      .then((result) => {
        if (!cancelled) setEntries(result.entries);
      })
      .catch((caught) => {
        if (cancelled) return;
        setEntries([]);
        setEntriesError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudieron cargar las sesiones.');
      })
      .finally(() => {
        if (!cancelled) setEntriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [territoryId, combinedRefreshToken]);

  // Refreshed after every open, close, and recorded session (combinedRefreshToken).
  useEffect(() => {
    let cancelled = false;
    setCyclesLoading(true);
    setCyclesError(null);
    listTerritoryCycles(territoryId)
      .then((result) => {
        if (!cancelled) setCycles(result.cycles);
      })
      .catch((caught) => {
        if (cancelled) return;
        setCycles([]);
        setCyclesError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudo cargar el historial de ciclos.');
      })
      .finally(() => {
        if (!cancelled) setCyclesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [territoryId, combinedRefreshToken]);

  // Stable identity: TerritoryTopBar refetches the status whenever this changes.
  const handleStatus = useCallback(
    (next: TerritoryOperationalStatus) => {
      setStatus(next);
      onRemainingAreaChange(next.remainingArea);
    },
    [onRemainingAreaChange]
  );

  const sessions = useMemo(() => currentCycleSessions(entries, status?.cycleNumber ?? null), [entries, status]);

  const bumpProgressVersion = useCallback(() => setProgressVersion((version) => version + 1), []);

  function recorderSlot(): JSX.Element | null {
    if (status === null) return null;
    if (isOpenState(status.state)) {
      return (
        <ProgressRecorder
          territoryId={territoryId}
          boundary={boundary}
          remainingArea={status.remainingArea}
          sessions={sessions}
          highlightedSessionId={hoveredSessionId ?? selectedSessionId}
          onRecorded={bumpProgressVersion}
        />
      );
    }
    return (
      <p className="recorder-closed" role="note">
        {status.state === 'no_record'
          ? 'Abre el territorio para empezar a registrar progreso.'
          : 'El territorio está cerrado. Ábrelo para registrar progreso.'}
      </p>
    );
  }

  return (
    <section aria-labelledby="territory-detail-heading">
      <div className="territory-detail-header">
        <h2 id="territory-detail-heading">Territorio</h2>
        <a
          className="detail-edit-link"
          href={`/territorios/${territoryId}/editar`}
          onClick={(event) => {
            event.preventDefault();
            onEdit();
          }}
        >
          Editar mapa
        </a>
      </div>
      <TerritoryTopBar
        territoryId={territoryId}
        slug={slug}
        refreshToken={combinedRefreshToken}
        cycles={cycles}
        onChanged={bumpProgressVersion}
        onStatus={handleStatus}
      />
      {recorderSlot()}
      <ProgressList
        entries={entries}
        sessions={sessions}
        loading={entriesLoading}
        error={entriesError}
        highlightedSessionId={hoveredSessionId ?? selectedSessionId}
        selectedSessionId={selectedSessionId}
        onHover={setHoveredSessionId}
        onSelect={setSelectedSessionId}
      />
      <CycleHistory cycles={cycles} loading={cyclesLoading} error={cyclesError} />
    </section>
  );
}
