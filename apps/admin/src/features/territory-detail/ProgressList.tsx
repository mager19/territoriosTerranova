import { useEffect, useState, type JSX } from 'react';

import { ApiError, describeApiError, listProgress, type ProgressEntry } from '../../api/client.js';

export interface ProgressListProps {
  readonly territoryId: number;
  readonly refreshToken: number;
}

/**
 * Read-only progress display, scoped directly to a territory (2026-09-08:
 * territories are shared to a group, not assigned to one person, so
 * progress is never gated by an "active assignment" precondition anymore
 * — only the administrator records it). This list preserves the immutable
 * evidence history; the operational summary owns the current-cycle coverage
 * snapshot so an older entry cannot be mistaken for reopened-cycle coverage.
 */
export function ProgressList({ territoryId, refreshToken }: ProgressListProps): JSX.Element {
  const [entries, setEntries] = useState<readonly ProgressEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listProgress(territoryId)
      .then((result) => {
        if (cancelled) return;
        setEntries(result.entries);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudo cargar el progreso.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [territoryId, refreshToken]);

  return (
    <section aria-labelledby="progress-heading">
      <h3 id="progress-heading">Progreso</h3>
      {loading && <p role="status">Cargando progreso…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && entries.length === 0 && <p>Todavía no hay progreso registrado para este territorio.</p>}
      <ol>
        {entries.map((entry) => (
          <li key={entry.id}>
            {new Date(entry.recordedAt).toLocaleString()} por {entry.recordedBy}
            {entry.note && <> — {entry.note}</>}
            {' — '}
            <span>
              área restante:{' '}
              {entry.remainingAreaStatus === 'recorded' ? 'registrada (se muestra en el mapa)' : <strong>desconocida</strong>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
