import { useEffect, useState, type JSX } from 'react';

import { ApiError, getTerritoryAudit, type AuditEvent } from '../../api/client.js';

export interface AuditHistoryProps {
  readonly territoryId: number;
  readonly refreshToken: number;
}

const ACTION_LABELS: Record<string, string> = {
  created: 'Territory created',
  revision_submitted: 'New geometry revision submitted',
  assigned: 'Assigned',
  returned: 'Returned',
  completed: 'Completed',
  reopened: 'Reopened',
  progress_recorded: 'Progress recorded'
};

/**
 * The full audit history for a territory (A5 brief slice 2), backed by
 * A3's GET /admin/territories/:id/audit — one chronological timeline
 * spanning the territory's own events and every event recorded against its
 * assignments. Read-only, in event order; nothing here is ever editable —
 * every row is a permanent fact (AGENTS.md).
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
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'could not load audit history');
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
      <h3 id="audit-heading">Audit history</h3>
      {loading && <p role="status">Loading audit history…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && events.length === 0 && <p>No audit events yet.</p>}
      <ol>
        {events.map((event) => (
          <li key={event.id}>
            {new Date(event.createdAt).toLocaleString()} — {ACTION_LABELS[event.action] ?? event.action} by{' '}
            {event.actor}
            {event.reason && <> — {event.reason}</>}
          </li>
        ))}
      </ol>
    </section>
  );
}
