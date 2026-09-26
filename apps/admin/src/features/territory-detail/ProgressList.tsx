import type { JSX } from 'react';

import type { ProgressEntry } from '../../api/client.js';
import { isNothingRemaining, type CoverageSession } from './sessions.js';

export interface ProgressListProps {
  /** Every recorded entry, oldest first (the immutable history). */
  readonly entries: readonly ProgressEntry[];
  /** Sessions of the current cycle — drawn in color on the map, interactive here. */
  readonly sessions: readonly CoverageSession[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly highlightedSessionId: number | null;
  readonly selectedSessionId: number | null;
  /** Hover preview: an entry id, or null when the pointer leaves. */
  readonly onHover: (entryId: number | null) => void;
  /** Click toggles a sticky selection. */
  readonly onSelect: (entryId: number | null) => void;
}

function remainingLabel(entry: ProgressEntry): JSX.Element | string {
  if (entry.remainingAreaStatus === 'unknown') return <strong>desconocida</strong>;
  return isNothingRemaining(entry.remainingArea) ? 'nada pendiente' : 'registrada';
}

function evidenceLabel(entry: ProgressEntry): string {
  const parts = [entry.pausePoint ? 'con punto de pausa' : null, entry.route ? 'con ruta' : null].filter(
    (part): part is string => part !== null
  );
  return parts.length === 0 ? '' : ` · ${parts.join(', ')}`;
}

/**
 * Session list / timeline. Sessions of the current cycle carry the same
 * color as their covered area on the map; hovering previews one there and
 * clicking pins it (click again to release). Entries from earlier cycles
 * (or from before coverage sessions existed) stay listed as plain history —
 * the immutable record is never hidden, only not colored.
 */
export function ProgressList({
  entries,
  sessions,
  loading,
  error,
  highlightedSessionId,
  selectedSessionId,
  onHover,
  onSelect
}: ProgressListProps): JSX.Element {
  const sessionByEntryId = new Map(sessions.map((session) => [session.entry.id, session]));

  return (
    <section aria-labelledby="progress-heading">
      <h3 id="progress-heading">Sesiones</h3>
      {loading && <p role="status">Cargando sesiones…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && entries.length === 0 && <p>Todavía no hay sesiones registradas para este territorio.</p>}
      {sessions.length > 0 && (
        <p className="editor-hint">Pasá el cursor o hacé clic sobre una sesión para resaltarla en el mapa.</p>
      )}
      <ol className="session-list">
        {entries.map((entry) => {
          const session = sessionByEntryId.get(entry.id);
          const when = new Date(entry.recordedAt).toLocaleString();
          const details = (
            <>
              {' — '}
              {when} por {entry.recordedBy}
              {entry.note && <> — {entry.note}</>}
              {entry.baseline === 'whole_territory' && ' · partió de todo el territorio'}
              {evidenceLabel(entry)}
              {' · área pendiente: '}
              {remainingLabel(entry)}
            </>
          );

          if (!session) {
            return (
              <li key={entry.id} className="session-item session-item--history">
                {entry.cycleNumber === null ? 'Registro anterior' : `Ciclo ${entry.cycleNumber}`}
                {details}
              </li>
            );
          }

          const highlighted = highlightedSessionId === entry.id;
          const selected = selectedSessionId === entry.id;
          return (
            <li key={entry.id} className={`session-item${highlighted ? ' session-item--highlighted' : ''}`}>
              <button
                type="button"
                className="session-toggle"
                aria-pressed={selected}
                onMouseEnter={() => onHover(entry.id)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(entry.id)}
                onBlur={() => onHover(null)}
                onClick={() => onSelect(selected ? null : entry.id)}
              >
                <span className="session-swatch" style={{ backgroundColor: session.color }} aria-hidden="true" />
                Sesión {session.number}
              </button>
              {details}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
