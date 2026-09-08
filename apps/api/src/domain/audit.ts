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
