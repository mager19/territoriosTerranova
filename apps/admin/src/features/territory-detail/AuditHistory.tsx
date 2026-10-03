import { useEffect, useState, type JSX } from 'react';

import { ApiError, describeApiError, getTerritoryAudit, type AuditEvent } from '../../api/client.js';

export interface AuditHistoryProps {
  readonly territoryId: number;
  readonly refreshToken: number;
}

const ACTION_LABELS: Record<string, string> = {
  created: 'Territorio creado',
  revision_submitted: 'Nueva revisión de geometría',
  shared: 'Compartido con el grupo de voluntarios',
  share_revoked: 'Link de compartir revocado',
  progress_recorded: 'Progreso registrado',
  operational_in_progress: 'Territorio abierto',
  operational_paused: 'Trabajo pausado',
  operational_cycle_completed: 'Territorio cerrado',
  operational_reopened: 'Territorio abierto de nuevo (ciclo nuevo)'
};

/**
 * The full audit history for a territory, backed by GET
 * /admin/territories/:id/audit — one chronological timeline. Everything is
 * territory-scoped since 2026-09-08's removal of individual assignment
 * (db/migrations/0004_remove_individual_assignment.sql) — there is no
 * separate assignment entity to interleave events from anymore. Read-only,
 * in event order; nothing here is ever editable — every row is a
 * permanent fact (AGENTS.md). This is also the one place per-revision
 * history is shown (TerritoryList's own copy was removed as redundant,
 * 2026-09-08 — see that component's comment).
 */
export function AuditHistory({ territoryId, refreshToken }: AuditHistoryProps): JSX.Element {
  const [events, setEvents] = useState<readonly AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getTerritoryAudit(territoryId)
      .then((result) => {
        if (!cancelled) setEvents(result.events);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudo cargar el historial de auditoría.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [territoryId, refreshToken]);

  return (
    <section aria-labelledby="audit-heading">
      <h3 id="audit-heading">Historial de auditoría</h3>
      {loading && <p role="status">Cargando historial de auditoría…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && events.length === 0 && <p>Todavía no hay eventos de auditoría.</p>}
      <ol>
        {events.map((event) => (
          <li key={event.id}>
            {new Date(event.createdAt).toLocaleString()} — {ACTION_LABELS[event.action] ?? event.action} por{' '}
            {event.actor}
            {event.reason && <> — {event.reason}</>}
          </li>
        ))}
      </ol>
    </section>
  );
}
