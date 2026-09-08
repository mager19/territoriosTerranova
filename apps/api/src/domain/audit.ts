/**
 * Every lifecycle transition writes an audit event (AGENTS.md, A3 brief
 * DoD). Callers pass an already-open transactional client so the audit row
 * commits or rolls back atomically with the state change it records.
 */

export interface Queryable {
  // No constraint on T beyond `object` — matching pg's own lax QueryResultRow
  // typing lets this accept concrete row interfaces like AssignmentRow
  // (which, having no index signature, is NOT assignable to
  // Record<string, unknown> under TS's structural rules).
  query: <T extends object = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: T[] }>;
}

export interface AuditEventInput {
  readonly entityType: string;
  readonly entityId: number;
  readonly action: string;
  readonly actor: string;
  readonly reason: string;
  readonly payload?: Record<string, unknown>;
}

export async function recordAuditEvent(db: Queryable, input: AuditEventInput): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (entity_type, entity_id, action, actor, reason, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.entityType,
      input.entityId,
      input.action,
      input.actor,
      input.reason,
      JSON.stringify(input.payload ?? {})
    ]
  );
}

export interface AuditEvent {
  readonly id: number;
  readonly entityType: string;
  readonly entityId: number;
  readonly action: string;
  readonly actor: string;
  readonly reason: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

interface AuditEventRow {
  readonly id: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly action: string;
  readonly actor: string;
  readonly reason: string;
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
}

/**
 * The full audit history for a territory (A3 brief, slice 3): every event
 * recorded directly against the territory (created, revision_submitted)
 * PLUS every event recorded against any of its assignments (assigned,
 * returned, completed, reopened, progress_recorded) — one coherent
 * chronological timeline, not just the territory's own events. Does NOT
 * verify the territory exists; callers that need a 404 for a missing
 * territory should check that separately (an empty array here is
 * ambiguous between "no history yet" and "no such territory").
 */
export async function getTerritoryAuditHistory(db: Queryable, territoryId: number): Promise<readonly AuditEvent[]> {
  const { rows } = await db.query<AuditEventRow>(
    `SELECT id, entity_type, entity_id, action, actor, reason, payload, created_at
     FROM audit_events
     WHERE (entity_type = 'territory' AND entity_id = $1)
        OR (entity_type = 'assignment' AND entity_id IN (SELECT id FROM assignments WHERE territory_id = $1))
     ORDER BY created_at ASC, id ASC`,
    [territoryId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    entityType: row.entity_type,
    entityId: Number(row.entity_id),
    action: row.action,
    actor: row.actor,
    reason: row.reason,
    payload: row.payload,
    createdAt: row.created_at
  }));
}
