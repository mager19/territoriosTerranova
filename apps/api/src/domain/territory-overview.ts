/**
 * Read-only aggregation behind the administrator's overview screen.
 *
 * Two rules this file exists to enforce, both of which would otherwise fail
 * silently:
 *
 * - A visit is a distinct LOCAL calendar day with at least one progress
 *   entry, never a row count. Someone recording a pause and a resume made
 *   one outing.
 * - Months are bucketed in America/Bogota. recorded_at is timestamptz, so
 *   bucketing in UTC would push a Sunday evening outing into the next month.
 *
 * lastWorkedAt is deliberately all-time rather than windowed: it is the only
 * thing that separates "never worked" from "nothing in the last N months".
 *
 * recorded_by is never selected here. This view speaks about territories,
 * not people (design doc, 2026-09-09).
 */

import { ValidationError } from './errors.js';
import { withTransaction, type TransactionalPool } from '../db/transaction.js';

export interface TerritoryOverviewMonth {
  readonly month: string;
  readonly times: number;
}

export interface TerritoryOverviewRow {
  readonly id: number;
  readonly number: string | null;
  readonly name: string;
  readonly status: 'active' | 'archived';
  readonly areaHectares: number | null;
  readonly lastWorkedAt: string | null;
  readonly monthly: readonly TerritoryOverviewMonth[];
}

interface OverviewDbRow {
  readonly id: string;
  readonly number: string | null;
  readonly name: string;
  readonly status: 'active' | 'archived';
  readonly area_hectares: string | null;
  readonly last_worked_at: Date | null;
  readonly monthly: readonly TerritoryOverviewMonth[];
}

const TIME_ZONE = 'America/Bogota';

export interface TerritoryOverviewOptions {
  readonly months: number;
  readonly includeArchived: boolean;
}

export async function getTerritoryOverview(
  pool: TransactionalPool,
  options: TerritoryOverviewOptions
): Promise<readonly TerritoryOverviewRow[]> {
  if (!Number.isInteger(options.months) || options.months <= 0) {
    throw new ValidationError('months must be a positive integer');
  }

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<OverviewDbRow>(
      `WITH bounds AS (
         SELECT date_trunc('month', (now() AT TIME ZONE $3)) AS current_month
       ),
       months AS (
         SELECT to_char(m, 'YYYY-MM') AS month
         FROM bounds b,
              generate_series(
                b.current_month - make_interval(months => $1::int - 1),
                b.current_month,
                interval '1 month'
              ) AS m
       ),
       visits AS (
         SELECT p.territory_id,
                to_char(date_trunc('month', (p.recorded_at AT TIME ZONE $3)), 'YYYY-MM') AS month,
                count(DISTINCT (p.recorded_at AT TIME ZONE $3)::date) AS times
         FROM progress_entries p
         GROUP BY 1, 2
       )
       SELECT t.id,
              t.number,
              t.name,
              t.status,
              (SELECT max(p.recorded_at)
                 FROM progress_entries p
                WHERE p.territory_id = t.id) AS last_worked_at,
              (SELECT (ST_Area(r.geom::geography) / 10000.0)::text
                 FROM territory_revisions r
                WHERE r.territory_id = t.id
                ORDER BY r.revision_number DESC
                LIMIT 1) AS area_hectares,
              json_agg(
                json_build_object('month', mo.month, 'times', COALESCE(v.times, 0)::int)
                ORDER BY mo.month
              ) AS monthly
         FROM territories t
        CROSS JOIN months mo
         LEFT JOIN visits v ON v.territory_id = t.id AND v.month = mo.month
        WHERE ($2::boolean OR t.status = 'active')
        GROUP BY t.id, t.number, t.name, t.status
        ORDER BY length(t.number) NULLS LAST, t.number NULLS LAST, t.id`,
      [options.months, options.includeArchived, TIME_ZONE]
    );

    return rows.map((row) => ({
      id: Number(row.id),
      number: row.number,
      name: row.name,
      status: row.status,
      areaHectares: row.area_hectares === null ? null : Number(row.area_hectares),
      lastWorkedAt: row.last_worked_at === null ? null : row.last_worked_at.toISOString(),
      monthly: row.monthly
    }));
  });
}
