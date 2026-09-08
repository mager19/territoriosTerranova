import { useState, type JSX } from 'react';

import type { Assignment, ProgressEntry } from '../../api/client.js';
import { AssignmentPanel } from './AssignmentPanel.js';
import { AuditHistory } from './AuditHistory.js';
import { ProgressList } from './ProgressList.js';

export interface TerritoryDetailProps {
  readonly territoryId: number;
  readonly refreshToken: number;
  /** Forwarded up to App so the map (TerritoryEditor) can render it as an overlay. */
  readonly onRemainingAreaChange: (geometry: ProgressEntry['remainingArea']) => void;
}

/**
 * Composes slice 2's three read/act panels for the selected territory:
 * assignment lifecycle actions, recorded progress, and the full audit
 * trail. `assignmentVersion` bumps ONLY when AssignmentPanel reports a new
 * current assignment, and feeds ONLY into ProgressList/AuditHistory — never
 * back into AssignmentPanel's own `refreshToken`, which would create an
 * infinite refetch loop (AssignmentPanel already refetches itself after
 * every action it takes; it does not need an external nudge from its own
 * output).
 */
export function TerritoryDetail({ territoryId, refreshToken, onRemainingAreaChange }: TerritoryDetailProps): JSX.Element {
  const [assignmentVersion, setAssignmentVersion] = useState(0);
  const [currentAssignment, setCurrentAssignment] = useState<Assignment | null>(null);

  return (
    <section aria-labelledby="territory-detail-heading">
      <h2 id="territory-detail-heading">Assignment, progress & history</h2>
      <AssignmentPanel
        territoryId={territoryId}
        refreshToken={refreshToken}
        onCurrentAssignmentChange={(assignment) => {
          setCurrentAssignment(assignment);
          setAssignmentVersion((version) => version + 1);
        }}
      />
      <ProgressList
        assignmentId={currentAssignment?.id ?? null}
        refreshToken={refreshToken + assignmentVersion}
        onLatestRemainingArea={onRemainingAreaChange}
      />
      <AuditHistory territoryId={territoryId} refreshToken={refreshToken + assignmentVersion} />
    </section>
  );
}
