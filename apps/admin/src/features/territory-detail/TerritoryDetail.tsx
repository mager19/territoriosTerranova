import { useState, type JSX } from 'react';

import type { ProgressEntry } from '../../api/client.js';
import { AuditHistory } from './AuditHistory.js';
import { ProgressList } from './ProgressList.js';
import { ProgressRecorder } from './ProgressRecorder.js';
import { SharePanel } from './SharePanel.js';
import type { Polygon } from '@territorios/geo';

export interface TerritoryDetailProps {
  readonly territoryId: number;
  readonly boundary: Polygon | null;
  readonly refreshToken: number;
  /** Forwarded up to App so the map (TerritoryEditor) can render it as an overlay. */
  readonly onRemainingAreaChange: (geometry: ProgressEntry['remainingArea']) => void;
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
export function TerritoryDetail({ territoryId, boundary, refreshToken, onRemainingAreaChange }: TerritoryDetailProps): JSX.Element {
  const [progressVersion, setProgressVersion] = useState(0);
  const combinedRefreshToken = refreshToken + progressVersion;

  return (
    <section aria-labelledby="territory-detail-heading">
      <h2 id="territory-detail-heading">Compartir, progreso e historial</h2>
      <SharePanel territoryId={territoryId} />
      <ProgressRecorder
        territoryId={territoryId}
        boundary={boundary}
        onRecorded={() => setProgressVersion((version) => version + 1)}
      />
      <ProgressList territoryId={territoryId} refreshToken={combinedRefreshToken} onLatestRemainingArea={onRemainingAreaChange} />
      <AuditHistory territoryId={territoryId} refreshToken={combinedRefreshToken} />
    </section>
  );
}
