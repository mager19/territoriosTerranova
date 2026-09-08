/**
 * AMVA / SIM POT Bello cache fetcher.
 *
 * Pulls the two reference layers documented in docs/map-references.md and
 * writes them to db/seed/cache/ so the seed NEVER depends on a government
 * service being reachable:
 *
 *   - layer 9  `Barrios`                   (139 features, measured)
 *   - layer 8  `Limit_Municipal_POT_2009`  (municipal boundary, 1 feature)
 *
 * Non-negotiable request rules (docs/map-references.md):
 *   - f=geojson&outSR=4326 — the service's native projection is a custom
 *     Azimuthal Equidistant on datum Bogota; raw output is unusable.
 *   - maxAllowableOffset=0.00002 (~2.2 m) — measured 159 KB vs 2.0 MB for
 *     the same 139 features.
 *
 * This data is a DRAFTING REFERENCE (POT 2009 vintage, (c) 2017 AMVA), never
 * a legal or cadastral boundary, and must never reach a public-facing path.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE_URL =
  'https://sim.metropol.gov.co/arcgis/rest/services/Planes_Ordenamiento_Territorial/POT_Bello/MapServer';

/** ~2.2 m simplification; see the payload measurements in docs/map-references.md. */
const MAX_ALLOWABLE_OFFSET = '0.00002';

export const ATTRIBUTION =
  '© 2017 Área Metropolitana del Valle de Aburrá — POT Bello (MapServer). Drafting reference only: not a legal or cadastral boundary.';

const BARRIOS_OUT_FIELDS =
  'Nombre,CodigoPOT,codigoDANE,CodigoCatastro,CodCOMUNA,Extension,Poblacion,EstratoPredom';

export const BARRIOS_URL =
  `${BASE_URL}/9/query?where=1%3D1&outFields=${BARRIOS_OUT_FIELDS}` +
  `&returnGeometry=true&outSR=4326&maxAllowableOffset=${MAX_ALLOWABLE_OFFSET}&f=geojson`;

export const BOUNDARY_URL =
  `${BASE_URL}/8/query?where=1%3D1&outFields=*` +
  `&returnGeometry=true&outSR=4326&maxAllowableOffset=${MAX_ALLOWABLE_OFFSET}&f=geojson`;

export const BARRIOS_FILE = 'barrios-layer9.geojson';
export const BOUNDARY_FILE = 'municipal-boundary-layer8.geojson';
export const MANIFEST_FILE = 'manifest.json';

export interface AmvaLayerEntry {
  readonly url: string;
  readonly file: string;
  readonly count: number;
}

export interface AmvaCacheManifest {
  readonly fetchedAt: string;
  readonly attribution: string;
  readonly maxAllowableOffsetDegrees: string;
  readonly layers: {
    readonly barrios: AmvaLayerEntry;
    readonly municipalBoundary: AmvaLayerEntry;
  };
}

interface EsriFeature {
  readonly geometry?: unknown;
  readonly properties?: Record<string, unknown>;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchFeatureCollection(url: string): Promise<readonly EsriFeature[]> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`AMVA request failed: HTTP ${response.status} for ${url}`);
  }
  const parsed: unknown = await response.json();
  if (isRecordLike(parsed) && 'error' in parsed) {
    throw new Error(`AMVA service returned an error for ${url}: ${JSON.stringify(parsed.error)}`);
  }
  if (
    !isRecordLike(parsed) ||
    parsed.type !== 'FeatureCollection' ||
    !Array.isArray(parsed.features)
  ) {
    throw new Error(`AMVA response is not a GeoJSON FeatureCollection for ${url}`);
  }
  const features = parsed.features as EsriFeature[];
  const missingGeometry = features.filter((feature) => !isRecordLike(feature.geometry)).length;
  if (missingGeometry > 0) {
    throw new Error(`${missingGeometry} AMVA features lack geometry for ${url}`);
  }
  return features;
}

/**
 * Fetches both layers and writes the cache (two GeoJSON files + manifest)
 * into outDir. Fails loudly on any deviation from the documented shape.
 */
export async function fetchAmvaCache(outDir: string): Promise<AmvaCacheManifest> {
  const fetchedAt = new Date().toISOString();

  const barrios = await fetchFeatureCollection(BARRIOS_URL);
  const boundary = await fetchFeatureCollection(BOUNDARY_URL);

  if (barrios.length === 0) {
    throw new Error('AMVA layer 9 (Barrios) returned zero features');
  }
  if (boundary.length !== 1) {
    throw new Error(`AMVA layer 8 must return exactly 1 boundary feature, got ${boundary.length}`);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, BARRIOS_FILE),
    `${JSON.stringify({ type: 'FeatureCollection', features: barrios })}\n`
  );
  writeFileSync(
    path.join(outDir, BOUNDARY_FILE),
    `${JSON.stringify({ type: 'FeatureCollection', features: boundary })}\n`
  );

  const manifest: AmvaCacheManifest = {
    fetchedAt,
    attribution: ATTRIBUTION,
    maxAllowableOffsetDegrees: MAX_ALLOWABLE_OFFSET,
    layers: {
      barrios: { url: BARRIOS_URL, file: BARRIOS_FILE, count: barrios.length },
      municipalBoundary: { url: BOUNDARY_URL, file: BOUNDARY_FILE, count: boundary.length }
    }
  };
  writeFileSync(path.join(outDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
