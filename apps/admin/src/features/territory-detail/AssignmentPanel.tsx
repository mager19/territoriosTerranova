import { useEffect, useState, type JSX } from 'react';

import {
  ApiError,
  assignTerritory,
  completeAssignment,
  listAssignments,
  reopenAssignment,
  returnAssignment,
  type Assignment
} from '../../api/client.js';

export interface AssignmentPanelProps {
  readonly territoryId: number;
  /** Bumped by the parent to force a refetch (e.g. after a save elsewhere). */
  readonly refreshToken: number;
  /** Called whenever the current assignment changes, so a sibling (ProgressList) can react. */
  readonly onCurrentAssignmentChange: (assignment: Assignment | null) => void;
}

/**
 * Assign, return, complete, and reopen — slice 2 of the A5 brief. Reopen
 * requires a reason IN THE UI, matching the server rule (AGENTS.md): the
 * "Reopen" button stays disabled until the reason field is non-blank, and
 * the same distinct-cause error surfacing from slice 1 applies here too.
 */
export function AssignmentPanel({ territoryId, refreshToken, onCurrentAssignmentChange }: AssignmentPanelProps): JSX.Element {
  const [assignments, setAssignments] = useState<readonly Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [assignedTo, setAssignedTo] = useState('');
  const [assignedBy, setAssignedBy] = useState('');
  const [actor, setActor] = useState('');
  const [reopenReason, setReopenReason] = useState('');

  const current = assignments.at(-1) ?? null;

  async function refetch(): Promise<void> {
    setLoading(true);
    try {
      const result = await listAssignments(territoryId);
      setAssignments(result.assignments);
      onCurrentAssignmentChange(result.assignments.at(-1) ?? null);
    } catch (caught) {
      setError(caught instanceof ApiError ? { code: caught.code, message: caught.message } : { code: 'unexpected_error', message: 'could not load assignments' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refetch();
  }, [territoryId, refreshToken]);

  async function runAction(action: () => Promise<Assignment>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refetch();
      setActor('');
      setReopenReason('');
      setAssignedTo('');
      setAssignedBy('');
    } catch (caught) {
      setError(caught instanceof ApiError ? { code: caught.code, message: caught.message } : { code: 'unexpected_error', message: 'the action failed; nothing changed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="assignment-heading">
      <h3 id="assignment-heading">Assignment</h3>
      {loading && <p role="status">Loading assignment…</p>}
      {error && (
        <p role="alert">
          <strong>{error.code}:</strong> {error.message}
        </p>
      )}

      {!loading && current === null && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void runAction(() => assignTerritory(territoryId, { assignedTo, assignedBy }));
          }}
        >
          <p>Not currently assigned.</p>
          <div>
            <label htmlFor="assigned-to">Assign to (field worker)</label>
            <input id="assigned-to" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="assigned-by">Your name</label>
            <input id="assigned-by" value={assignedBy} onChange={(e) => setAssignedBy(e.target.value)} required />
          </div>
          <button type="submit" disabled={busy || assignedTo.trim() === '' || assignedBy.trim() === ''}>
            Assign
          </button>
        </form>
      )}

      {!loading && current !== null && current.status === 'active' && (
        <form onSubmit={(event) => event.preventDefault()}>
          <p>
            Assigned to <strong>{current.assignedTo}</strong> since {new Date(current.assignedAt).toLocaleString()}.
          </p>
          <div>
            <label htmlFor="assignment-actor">Your name</label>
            <input id="assignment-actor" value={actor} onChange={(e) => setActor(e.target.value)} required />
          </div>
          <div role="group" aria-label="Assignment actions" style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              disabled={busy || actor.trim() === ''}
              onClick={() => void runAction(() => returnAssignment(current.id, actor))}
            >
              Return
            </button>
            <button
              type="button"
              disabled={busy || actor.trim() === ''}
              onClick={() => void runAction(() => completeAssignment(current.id, actor))}
            >
              Complete
            </button>
          </div>
        </form>
      )}

      {!loading && current !== null && current.status !== 'active' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void runAction(() => reopenAssignment(current.id, actor, reopenReason));
          }}
        >
          <p>
            {current.status === 'returned' ? 'Returned' : 'Completed'} — was assigned to{' '}
            <strong>{current.assignedTo}</strong>.
          </p>
          <div>
            <label htmlFor="reopen-actor">Your name</label>
            <input id="reopen-actor" value={actor} onChange={(e) => setActor(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="reopen-reason">Reason for reopening (required)</label>
            <input id="reopen-reason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} required />
          </div>
          <button type="submit" disabled={busy || actor.trim() === '' || reopenReason.trim() === ''}>
            Reopen
          </button>
        </form>
      )}
    </section>
  );
}
