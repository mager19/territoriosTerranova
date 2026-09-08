/**
 * Assignment lifecycle — slice 2 of the A3 brief: assign a territory to a
 * field worker, return it, complete it, and reopen it with a mandatory
 * reason. Unlike territory_revisions, the assignments table is NOT
 * append-only (A2's schema updates status/timestamps in place on one row
 * per assignment "session") — but every transition still writes an
 * append-only audit_events row, so the history of who did what, when, and
 * why is never lost even though the assignments row itself mutates.
 *
 * An assignment references a specific territory_revision_id (A2's composite
 * FK guarantees it belongs to the right territory), so reopening — which
 * only flips status/reopen_reason on the SAME row — automatically preserves
 * the original geometry revision reference without any extra code.
 */

import { recordAuditEvent, type Queryable } from './audit.js';
import {
  AssignmentNotActiveError,
  AssignmentNotFoundError,
  TerritoryNotFoundError,
  ValidationError
} from './errors.js';
import { rethrowAsAssignmentError } from '../db/pg-error-mapper.js';
import { withTransaction, type TransactionalPool } from '../db/transaction.js';

export type AssignmentStatus = 'active' | 'completed' | 'returned';

export interface Assignment {
  readonly id: number;
  readonly territoryId: number;
  readonly territoryRevisionId: number;
  readonly revisionNumber: number;
  readonly assignedTo: string;
  readonly assignedBy: string;
  readonly status: AssignmentStatus;
  readonly assignedAt: string;
  readonly completedAt: string | null;
  readonly returnedAt: string | null;
  readonly reopenReason: string | null;
}

interface AssignmentRow {
  readonly id: string;
  readonly territory_id: string;
  readonly territory_revision_id: string;
  readonly revision_number: number;
  readonly assigned_to: string;
  readonly assigned_by: string;
  readonly status: AssignmentStatus;
  readonly assigned_at: string;
  readonly completed_at: string | null;
  readonly returned_at: string | null;
  readonly reopen_reason: string | null;
}

const ASSIGNMENT_SELECT_COLUMNS = `
  a.id, a.territory_id, a.territory_revision_id, r.revision_number,
  a.assigned_to, a.assigned_by, a.status, a.assigned_at,
  a.completed_at, a.returned_at, a.reopen_reason
`;
const ASSIGNMENT_FROM = `assignments a JOIN territory_revisions r ON r.id = a.territory_revision_id`;

function toAssignment(row: AssignmentRow): Assignment {
  return {
    id: Number(row.id),
    territoryId: Number(row.territory_id),
    territoryRevisionId: Number(row.territory_revision_id),
    revisionNumber: row.revision_number,
    assignedTo: row.assigned_to,
    assignedBy: row.assigned_by,
    status: row.status,
    assignedAt: row.assigned_at,
    completedAt: row.completed_at,
    returnedAt: row.returned_at,
    reopenReason: row.reopen_reason
  };
}

export interface AssignTerritoryInput {
  readonly assignedTo: string;
  readonly assignedBy: string;
}

export async function assignTerritory(
  pool: TransactionalPool,
  territoryId: number,
  input: AssignTerritoryInput
): Promise<Assignment> {
  const assignedTo = input.assignedTo.trim();
  const assignedBy = input.assignedBy.trim();
  if (assignedTo === '') {
    throw new ValidationError('assignedTo must not be blank');
  }
  if (assignedBy === '') {
    throw new ValidationError('assignedBy must not be blank');
  }

  return withTransaction(pool, async (client) => {
    const { rows: revisionRows } = await client.query<{ id: string }>(
      `SELECT id FROM territory_revisions WHERE territory_id = $1 ORDER BY revision_number DESC LIMIT 1`,
      [territoryId]
    );
    const currentRevisionId = revisionRows[0]?.id;
    if (currentRevisionId === undefined) {
      throw new TerritoryNotFoundError(territoryId);
    }

    try {
      const { rows } = await client.query<AssignmentRow>(
        `WITH inserted AS (
           INSERT INTO assignments (territory_id, territory_revision_id, assigned_to, assigned_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id, territory_id, territory_revision_id, assigned_to, assigned_by,
                     status, assigned_at, completed_at, returned_at, reopen_reason
         )
         SELECT inserted.id, inserted.territory_id, inserted.territory_revision_id,
                r.revision_number, inserted.assigned_to, inserted.assigned_by, inserted.status,
                inserted.assigned_at, inserted.completed_at, inserted.returned_at, inserted.reopen_reason
         FROM inserted JOIN territory_revisions r ON r.id = inserted.territory_revision_id`,
        [territoryId, currentRevisionId, assignedTo, assignedBy]
      );
      const row = rows[0];
      if (!row) {
        throw new Error('assignments insert returned no row');
      }

      await recordAuditEvent(client, {
        entityType: 'assignment',
        entityId: Number(row.id),
        action: 'assigned',
        actor: assignedBy,
        reason: `territory assigned to ${assignedTo}`,
        payload: { territoryId, territoryRevisionId: Number(currentRevisionId) }
      });

      return toAssignment(row);
    } catch (error) {
      rethrowAsAssignmentError(error);
    }
  });
}

async function lockActiveAssignment(client: Queryable, assignmentId: number): Promise<void> {
  const { rows } = await client.query<{ status: AssignmentStatus }>(
    `SELECT status FROM assignments WHERE id = $1 FOR UPDATE`,
    [assignmentId]
  );
  const row = rows[0];
  if (!row) {
    throw new AssignmentNotFoundError(assignmentId);
  }
  if (row.status !== 'active') {
    throw new AssignmentNotActiveError(`assignment ${assignmentId} is ${row.status}, not active`);
  }
}

async function fetchAssignment(client: Queryable, assignmentId: number): Promise<Assignment> {
  const { rows } = await client.query<AssignmentRow>(
    `SELECT ${ASSIGNMENT_SELECT_COLUMNS} FROM ${ASSIGNMENT_FROM} WHERE a.id = $1`,
    [assignmentId]
  );
  const row = rows[0];
  if (!row) {
    throw new AssignmentNotFoundError(assignmentId);
  }
  return toAssignment(row);
}

export async function returnAssignment(
  pool: TransactionalPool,
  assignmentId: number,
  actor: string
): Promise<Assignment> {
  return withTransaction(pool, async (client) => {
    await lockActiveAssignment(client, assignmentId);
    await client.query(`UPDATE assignments SET status = 'returned', returned_at = now() WHERE id = $1`, [
      assignmentId
    ]);
    await recordAuditEvent(client, {
      entityType: 'assignment',
      entityId: assignmentId,
      action: 'returned',
      actor,
      reason: 'assignment returned'
    });
    return fetchAssignment(client, assignmentId);
  });
}

export async function completeAssignment(
  pool: TransactionalPool,
  assignmentId: number,
  actor: string
): Promise<Assignment> {
  return withTransaction(pool, async (client) => {
    await lockActiveAssignment(client, assignmentId);
    await client.query(`UPDATE assignments SET status = 'completed', completed_at = now() WHERE id = $1`, [
      assignmentId
    ]);
    await recordAuditEvent(client, {
      entityType: 'assignment',
      entityId: assignmentId,
      action: 'completed',
      actor,
      reason: 'assignment completed'
    });
    return fetchAssignment(client, assignmentId);
  });
}

export interface ReopenAssignmentInput {
  readonly actor: string;
  readonly reason: string;
}

export async function reopenAssignment(
  pool: TransactionalPool,
  assignmentId: number,
  input: ReopenAssignmentInput
): Promise<Assignment> {
  const reason = input.reason.trim();
  if (reason === '') {
    // Fast client-side rejection (AGENTS.md: reopening requires an
    // auditable reason). The DB trigger enforce_reopen_reason is the last
    // line of defense if this check is ever bypassed — see
    // pg-error-mapper.ts's mapAssignmentError for that path.
    throw new ValidationError('reopening an assignment requires a non-blank reason');
  }

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ status: AssignmentStatus }>(
      `SELECT status FROM assignments WHERE id = $1 FOR UPDATE`,
      [assignmentId]
    );
    const current = rows[0];
    if (!current) {
      throw new AssignmentNotFoundError(assignmentId);
    }
    if (current.status === 'active') {
      throw new AssignmentNotActiveError(`assignment ${assignmentId} is already active`);
    }

    try {
      await client.query(
        `UPDATE assignments SET status = 'active', reopen_reason = $2 WHERE id = $1`,
        [assignmentId, reason]
      );
    } catch (error) {
      rethrowAsAssignmentError(error);
    }

    await recordAuditEvent(client, {
      entityType: 'assignment',
      entityId: assignmentId,
      action: 'reopened',
      actor: input.actor,
      reason
    });

    return fetchAssignment(client, assignmentId);
  });
}
