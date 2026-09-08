import { useEffect, useState, type JSX } from 'react';

import { ApiError, listProgress, type ProgressEntry } from '../../api/client.js';

export interface ProgressListProps {
  /** The current assignment's id, or null when the territory has no assignment yet. */
  readonly assignmentId: number | null;
  readonly refreshToken: number;
  /** The latest entry's remaining-area geometry (or null), so the parent can render it on the map. */
  readonly onLatestRemainingArea: (geometry: ProgressEntry['remainingArea']) => void;
}

/**
 * Read-only progress display (A5 brief slice 2: "Show recorded progress,
 * including remaining-area geometry when it exists"). Recording NEW
 * progress entries — drawing a pause point/route/remaining area — is not
 * built here: the brief's wording asks for display, and a full drawing UI
 * for three more optional geometries is a distinct, larger feature than
 * this slice's scope. Noted explicitly rather than silently omitted.
 */
export function ProgressList({ assignmentId, refreshToken, onLatestRemainingArea }: ProgressListProps): JSX.Element {
  const [entries, setEntries] = useState<readonly ProgressEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (assignmentId === null) {
      setEntries([]);
      onLatestRemainingArea(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listProgress(assignmentId)
      .then((result) => {
        if (cancelled) return;
        setEntries(result.entries);
        onLatestRemainingArea(result.entries.at(-1)?.remainingArea ?? null);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'could not load progress');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, refreshToken]);

  if (assignmentId === null) {
    return (
      <section aria-labelledby="progress-heading">
        <h3 id="progress-heading">Progress</h3>
        <p>No assignment yet — nothing to show.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="progress-heading">
      <h3 id="progress-heading">Progress</h3>
      {loading && <p role="status">Loading progress…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && entries.length === 0 && <p>No progress recorded yet for this assignment.</p>}
      <ol>
        {entries.map((entry) => (
          <li key={entry.id}>
            {new Date(entry.recordedAt).toLocaleString()} by {entry.recordedBy}
            {entry.note && <> — {entry.note}</>}
            {' — '}
            <span>
              remaining area:{' '}
              {entry.remainingAreaStatus === 'recorded' ? 'recorded (shown on the map)' : <strong>unknown</strong>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
