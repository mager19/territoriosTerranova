import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import { ApiError, describeApiError, listProgress, type ProgressEntry, type TerritoryOperationalStatus } from '../../api/client.js';
import { AuditHistory } from './AuditHistory.js';
import { ProgressList } from './ProgressList.js';
import { ProgressRecorder } from './ProgressRecorder.js';
import { OperationalStatusPanel } from './OperationalStatusPanel.js';
import { SharePanel } from './SharePanel.js';
import { currentCycleSessions } from './sessions.js';
import type { Polygon } from '@territorios/geo';

export interface TerritoryDetailProps {
  readonly territoryId: number;
  readonly boundary: Polygon | null;
  readonly refreshToken: number;
  /** Forwarded up to App so the map (TerritoryEditor) can render it as an overlay. */
  readonly onRemainingAreaChange: (geometry: ProgressEntry['remainingArea']) => void;
  /** Navigate to this territory's editor route (`/territorios/:id/editar`). */
  readonly onEdit: () => void;
}

/**
 * Composes the selected territory's four panels: sharing, recording
 * progress, recorded progress, and the full audit trail. Simpler than its
 * A5-original shape (2026-09-08: territories are shared to a group, not
 * assigned to one person) — progress and audit history are always
 * territory-scoped now, so they need only the same `refreshToken` the
 * parent already passes, plus a local `progressVersion` bumped when
 * ProgressRecorder saves (there is no more assignment-derived version
 * counter to thread through — the equivalent A5-original plumbing this
 * replaces).
 */
export function TerritoryDetail({ territoryId, boundary, refreshToken, onRemainingAreaChange, onEdit }: TerritoryDetailProps): JSX.Element {
  const [progressVersion, setProgressVersion] = useState(0);
  const combinedRefreshToken = refreshToken + progressVersion;
  const [status, setStatus] = useState<TerritoryOperationalStatus | null>(null);
  const [entries, setEntries] = useState<readonly ProgressEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  // Hover previews a session on the map; a click pins it until clicked again.
  const [hoveredSessionId, setHoveredSessionId] = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

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

  // Stable identity: OperationalStatusPanel refetches whenever this changes.
  const handleStatus = useCallback(
    (next: TerritoryOperationalStatus) => {
      setStatus(next);
      onRemainingAreaChange(next.remainingArea);
    },
    [onRemainingAreaChange]
  );

  const sessions = useMemo(() => currentCycleSessions(entries, status?.cycleNumber ?? null), [entries, status]);

  return (
    <section aria-labelledby="territory-detail-heading">
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
      <OperationalStatusPanel
        territoryId={territoryId}
        refreshToken={combinedRefreshToken}
        onChanged={() => setProgressVersion((version) => version + 1)}
        onRemainingAreaChange={handleStatus}
      />
      <ProgressRecorder
        territoryId={territoryId}
        boundary={boundary}
        remainingArea={status?.remainingArea ?? null}
        sessions={sessions}
        highlightedSessionId={hoveredSessionId ?? selectedSessionId}
        onRecorded={() => setProgressVersion((version) => version + 1)}
      />
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
      <SharePanel territoryId={territoryId} />
      <AuditHistory territoryId={territoryId} refreshToken={combinedRefreshToken} />
    </section>
  );
}
