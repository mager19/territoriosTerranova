/**
 * Integration test for the admin AMVA reference-barrio search, against real
 * PostGIS via Testcontainers. The fixture row below is inserted directly
 * (not fetched from the live AMVA service) — its attributes mirror the real,
 * live-verified "B. Guasimalito" record in docs/map-references.md; the
 * geometry itself is a simplified rectangle, not the real 208-vertex
 * boundary (irrelevant to what this suite proves: search + GeoJSON shape).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '@territorios/geo/db/migrate';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../app.js';

const IMAGE = 'postgis/postgis:16-3.4';

const FIXTURE_BARRIO_SQL = `
  INSERT INTO reference_barrios (nombre, codigo_pot, codigo_dane, extension_km2, poblacion_2004, geom, source_url, retrieved_at, attribution)
  VALUES ('B. Guasimalito', '08-06(42)', '0806', 0.14, 1599,
          ST_Multi(ST_SetSRID(ST_MakeEnvelope(-75.5253, 6.3451, -75.5215, 6.3500), 4326)),
          'integration-test-fixture', now(),
          'test fixture; see docs/map-references.md for the real live-verified AMVA data')
`;

let container: StartedPostgreSqlContainer;
let databaseUrl: string;
let pool: Pool;
let app: FastifyInstance;

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(IMAGE)
    .withDatabase('territorios_api_test')
    .withUsername('territorios')
    .withPassword('territorios')
    .withStartupTimeout(300_000)
    .start();
  databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);
  await withClient((client) => client.query(FIXTURE_BARRIO_SQL));

  pool = new Pool({ connectionString: databaseUrl, max: 5 });
  app = await buildApp({ queryPostgisVersion: async () => '3.4.3', pool }, { logger: false });
}, 360_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

describe('GET /admin/reference/barrios', () => {
  it('finds a barrio by a case-insensitive partial name match', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/reference/barrios?name=guasimalito' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.barrios).toHaveLength(1);
    expect(body.barrios[0]).toMatchObject({ name: 'B. Guasimalito', extensionKm2: 0.14, population: 1599 });
    expect(body.barrios[0].geometry.type).toBe('MultiPolygon');
  });

  it('returns an empty list (200, not 404) for a name with no match', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/reference/barrios?name=nonexistent-xyz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ barrios: [] });
  });

  it('rejects a missing name query param', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/reference/barrios' });

    expect(response.statusCode).toBe(400);
  });
});
