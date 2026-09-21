/**
 * AMVA reference-barrio lookup — admin-only drafting reference (AGENTS.md,
 * A2's hard constraint: never expose AMVA attributes or source URLs on any
 * public path). Read-only: `reference_barrios` is populated by the seed
 * script (packages/geo/src/db/seed.ts), never written here.
 *
 * Built 2026-09-08 in response to a real gap: an administrator expected one
 * "territorio" to cover a whole barrio (e.g. Guasimalito) and found only a
 * small fraction of it — a territory is a single manzana/block by design,
 * so a barrio needs several. This gives the admin editor a real AMVA
 * outline to draw against while building up that coverage one territory
 * at a time.
 */

import type { MultiPolygon } from '@territorios/geo';
import type { PoolClient } from 'pg';

import { withTransaction, type TransactionalPool } from '../db/transaction.js';

export interface ReferenceBarrio {
  readonly id: number;
  readonly name: string;
  readonly geometry: MultiPolygon;
  readonly extensionKm2: number | null;
  readonly population: number | null;
}

interface ReferenceBarrioRow {
  readonly id: string;
  readonly nombre: string;
  readonly geometry: MultiPolygon;
  readonly extension_km2: number | null;
  readonly poblacion_2004: number | null;
}

function toReferenceBarrio(row: ReferenceBarrioRow): ReferenceBarrio {
  return {
    id: Number(row.id),
    name: row.nombre,
    geometry: row.geometry,
    extensionKm2: row.extension_km2,
    population: row.poblacion_2004
  };
}

/**
 * Case-insensitive partial match on the barrio name — "guasimalito" finds
 * "B. Guasimalito", "niquía" finds all three AMVA sub-barrios covering that
 * area (docs/map-references.md). Returns an empty list for no match; there
 * is no "not found" error here, an empty result is a perfectly valid answer
 * to a search.
 */
export async function searchReferenceBarrios(pool: TransactionalPool, nameQuery: string): Promise<readonly ReferenceBarrio[]> {
  return withTransaction(pool, async (client: PoolClient) => {
    const { rows } = await client.query<ReferenceBarrioRow>(
      `SELECT id, nombre, ST_AsGeoJSON(geom)::json AS geometry, extension_km2, poblacion_2004
       FROM reference_barrios
       WHERE nombre ILIKE '%' || $1 || '%'
       ORDER BY nombre`,
      [nameQuery]
    );
    return rows.map(toReferenceBarrio);
  });
}
