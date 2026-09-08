/**
 * Idempotent AMVA reference seed — works OFFLINE from the committed cache in
 * db/seed/cache/ (regenerate the cache with `pnpm --filter @territorios/geo
 * db:fetch-amva`; the build never depends on the government service).
 *
 * Idempotency strategy: full replacement inside one transaction
 * (TRUNCATE ... RESTART IDENTITY + INSERT). Running the seed twice yields the
 * same row counts and the same data.
 *
 * Every row records source URL, retrieval date, and AMVA attribution, as
 * required by the reuse rules in docs/map-references.md.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

import {
  type AmvaCacheManifest,
  BARRIOS_FILE,
  BOUNDARY_FILE,
  MANIFEST_FILE
} from './fetch-amva.js';
import { REPO_ROOT } from './migrate.js';

export const DEFAULT_CACHE_DIR = path.join(REPO_ROOT, 'db', 'seed', 'cache');

export interface SeedResult {
  readonly barrios: number;
  readonly boundary: number;
}

interface GeoFeature {
  readonly geometry?: unknown;
  readonly properties?: Record<string, unknown>;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readManifest(cacheDir: string): AmvaCacheManifest {
  const raw = readJsonFile(path.join(cacheDir, MANIFEST_FILE));
  if (!isRecordLike(raw) || typeof raw.fetchedAt !== 'string' || !isRecordLike(raw.layers)) {
    throw new Error(`${MANIFEST_FILE} in ${cacheDir} is malformed; regenerate the AMVA cache`);
  }
  const layers = raw.layers;
  if (!isRecordLike(layers.barrios) || !isRecordLike(layers.municipalBoundary)) {
    throw new Error(`${MANIFEST_FILE} is missing layer entries; regenerate the AMVA cache`);
  }
  return raw as unknown as AmvaCacheManifest;
}

function readFeatures(cacheDir: string, file: string): GeoFeature[] {
  const raw = readJsonFile(path.join(cacheDir, file));
  if (!isRecordLike(raw) || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
    throw new Error(`${file} in ${cacheDir} is not a GeoJSON FeatureCollection`);
  }
  return raw.features as GeoFeature[];
}

function geometryJson(feature: GeoFeature, context: string): string {
  const geometry = feature.geometry;
  const geometryType =
    isRecordLike(geometry) && typeof geometry.type === 'string' ? geometry.type : null;
  if (!isRecordLike(geometry) || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
    throw new Error(
      `${context}: expected Polygon/MultiPolygon geometry, got ${JSON.stringify(geometryType)}`
    );
  }
  return JSON.stringify(geometry);
}

/**
 * SQL expression that turns a `$n` GeoJSON parameter into a sanitized,
 * SRID-4326 MultiPolygon: it dumps the source into its individual polygon
 * parts and keeps only those with positive area, then recombines them.
 *
 * This exists for exactly one verified reason (2026-09-08): of 139 real AMVA
 * layer-9 features, "Urb. Búcaros III" carries a MultiPolygon with two parts
 * — its real, valid boundary (10 vertices) plus an unrelated zero-area
 * artifact (4 near-duplicate points ~1m apart — a digitizing slip in the
 * source, not part of the neighborhood). PostGIS's own ST_IsValidReason
 * confirmed the failing component; every OTHER seeded barrio has none.
 *
 * This is bulk sanitization of a THIRD-PARTY reference dataset at import
 * time, not the "repair application-owned geometry silently" AGENTS.md
 * forbids — that guardrail governs administrator-drawn territory revisions,
 * which A3 must still reject outright, never touch here. A geometry that is
 * invalid for a reason OTHER than a zero-area component still fails the
 * `*_geom_valid` CHECK constraint below, on purpose: this only removes
 * degenerate slivers, it does not attempt general repair.
 */
function sanitizedMultiPolygonExpr(placeholder: string): string {
  return `(
    SELECT ST_Multi(ST_Collect(part.geom))
    FROM ST_Dump(ST_SetSRID(ST_GeomFromGeoJSON(${placeholder}), 4326)) AS part
    WHERE ST_Area(part.geom) > 0
  )`;
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'string' ? value : String(value);
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/**
 * The `Nombre` attribute is required on every seeded barrio EXCEPT when the
 * source record itself carries no attributes at all — verified against the
 * live AMVA layer 9 cache, exactly one of 139 features (index 81) has every
 * non-geometry attribute blank. That is a gap in the source, not a defect in
 * this loader: the polygon is a valid, real reference boundary with no
 * accompanying record. Per orchestrator decision (2026-09-08), such a barrio
 * is still loaded — dropping a real geometry loses drafting-reference data —
 * but is given a distinct, self-describing placeholder rather than a
 * fabricated name. The placeholder is deliberately impossible to confuse with
 * a real AMVA name so it can never be silently mistaken for one downstream.
 */
const UNNAMED_BARRIO_PLACEHOLDER = 'Sector sin nombre (AMVA no registra atributos para este polígono)';

function nombreOrPlaceholder(properties: Record<string, unknown>, context: string): string {
  const nombre = optionalString(properties.Nombre);
  const hasAnyOtherAttribute = [
    properties.CodigoPOT,
    properties.codigoDANE,
    properties.CodigoCatastro,
    properties.CodCOMUNA,
    properties.EstratoPredom
  ].some((value) => (optionalString(value) ?? '').trim() !== '');

  if (nombre !== null && nombre.trim() !== '') {
    return nombre;
  }
  if (!hasAnyOtherAttribute) {
    return UNNAMED_BARRIO_PLACEHOLDER;
  }
  // A barrio with SOME attributes but no name is a different, undiagnosed
  // shape of gap — fail loudly rather than guess.
  throw new Error(`${context}: missing required attribute Nombre`);
}

export async function runSeed(
  databaseUrl: string,
  cacheDir: string = DEFAULT_CACHE_DIR
): Promise<SeedResult> {
  const manifest = readManifest(cacheDir);
  // The manifest names the cache files; fall back to the canonical names when
  // absent so a hand-edited manifest cannot point outside the cache.
  const barriosFile = manifest.layers.barrios.file || BARRIOS_FILE;
  const boundaryFile = manifest.layers.municipalBoundary.file || BOUNDARY_FILE;
  const barrios = readFeatures(cacheDir, barriosFile);
  const boundary = readFeatures(cacheDir, boundaryFile);

  if (barrios.length === 0) {
    throw new Error(`${barriosFile} contains zero features`);
  }
  if (boundary.length !== 1) {
    throw new Error(`${boundaryFile} must contain exactly 1 boundary feature, got ${boundary.length}`);
  }

  const attribution = manifest.attribution;
  const retrievedAt = manifest.fetchedAt;
  const barriosUrl = manifest.layers.barrios.url;
  const boundaryUrl = manifest.layers.municipalBoundary.url;

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');

    // Full replacement: the seed is idempotent by construction.
    await client.query('TRUNCATE reference_barrios, reference_municipal_boundary RESTART IDENTITY');

    await client.query(
      `INSERT INTO reference_municipal_boundary (id, name, geom, source_url, retrieved_at, attribution)
       VALUES (1, 'Bello', ${sanitizedMultiPolygonExpr('$1')}, $2, $3::timestamptz, $4)`,
      [geometryJson(boundary[0] as GeoFeature, 'municipal boundary'), boundaryUrl, retrievedAt, attribution]
    );

    for (const [index, feature] of barrios.entries()) {
      const properties = feature.properties ?? {};
      const context = `barrio #${index}`;
      await client.query(
        `INSERT INTO reference_barrios (
           nombre, codigo_pot, codigo_dane, codigo_catastro, cod_comuna,
           extension_km2, poblacion_2004, estrato_predominante,
           geom, source_url, retrieved_at, attribution
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                 ${sanitizedMultiPolygonExpr('$9')}, $10, $11::timestamptz, $12)`,
        [
          nombreOrPlaceholder(properties, context),
          optionalString(properties.CodigoPOT),
          optionalString(properties.codigoDANE),
          optionalString(properties.CodigoCatastro),
          optionalString(properties.CodCOMUNA),
          optionalNumber(properties.Extension),
          optionalNumber(properties.Poblacion),
          optionalString(properties.EstratoPredom),
          geometryJson(feature, context),
          barriosUrl,
          retrievedAt,
          attribution
        ]
      );
    }

    await client.query('COMMIT');
    return { barrios: barrios.length, boundary: 1 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
