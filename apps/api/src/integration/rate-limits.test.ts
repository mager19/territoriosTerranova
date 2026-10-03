/**
 * Rate limits shared through PostgreSQL (db/migrations/0010_rate_limits.sql,
 * rate-limit/pg-store.ts) against real PostGIS (Testcontainers). The point:
 * on Vercel every function instance is a separate process, so two app
 * instances built by createApi() over one database must share every limit,
 * while the 429 response stays exactly what the in-memory store produced.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '@territorios/geo/db/migrate';
import type { FastifyInstance, InjectOptions } from 'fastify';

import { buildApp } from '../app.js';
import { readConfig, type ApiConfig } from '../config.js';
import { createApi, type CreatedApi } from '../create-api.js';
import {
  createPgRateLimitStore,
  deleteExpiredRateLimitCounters,
  hashRateLimitKey
} from '../rate-limit/pg-store.js';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, testAuthConfig } from '../test-support/admin-auth.js';

const IMAGE = 'postgis/postgis:16-3.4';
const UNKNOWN_TOKEN = 'no-such-token-0123456789abcdef';

let container: StartedPostgreSqlContainer;
let databaseUrl: string;
let pool: Pool;
const created: CreatedApi[] = [];

function configFor(env: Record<string, string> = {}): ApiConfig {
  return readConfig({
    DATABASE_URL: databaseUrl,
    ADMIN_1_EMAIL: TEST_ADMIN_EMAIL,
    ADMIN_1_PASSWORD: TEST_ADMIN_PASSWORD,
    ...env
  });
}

/** A production-wired instance (createApi: own pool, PostgreSQL store), like one Vercel instance. */
async function instance(env: Record<string, string> = {}): Promise<FastifyInstance> {
  const api = await createApi(configFor(env), { poolDefaults: { max: 2 }, logger: false });
  created.push(api);
  return api.app;
}

function login(app: FastifyInstance, extra: Partial<InjectOptions> = {}) {
  return app.inject({
    method: 'POST',
    url: '/admin/auth/login',
    payload: { email: TEST_ADMIN_EMAIL, password: 'wrong-password-000' },
    ...extra
  });
}

function share(app: FastifyInstance, remoteAddress = '127.0.0.1') {
  return app.inject({ method: 'GET', url: `/public/territories/${UNKNOWN_TOKEN}`, remoteAddress });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(IMAGE)
    .withDatabase('territorios_api_rate_limits_test')
    .withUsername('territorios')
    .withPassword('territorios')
    .withStartupTimeout(300_000)
    .start();
  databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);
  pool = new Pool({ connectionString: databaseUrl, max: 5 });
});

beforeEach(async () => {
  await pool.query('TRUNCATE rate_limit_counters');
});

afterAll(async () => {
  for (const api of created) {
    await api.app.close();
    await api.pool.end();
  }
  await pool?.end();
  await container?.stop();
});

describe('limits shared across instances', () => {
  it('counts sign-in attempts from one client on every instance: the sixth attempt anywhere gets 429', async () => {
    const a = await instance();
    const b = await instance();

    const statuses: number[] = [];
    for (const app of [a, b, a, b, a]) statuses.push((await login(app)).statusCode);
    expect(statuses).toEqual([401, 401, 401, 401, 401]);

    const blocked = await login(b, { payload: { email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD } });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['set-cookie']).toBeUndefined();
  });

  it('answers 429 exactly like the in-memory store did: same body and rate-limit headers', async () => {
    const shared = await instance();
    const inMemory = await buildApp(
      { queryPostgisVersion: async () => '3.4.3', pool, auth: { config: testAuthConfig() } },
      { logger: false }
    );
    try {
      const responses = [];
      for (const app of [shared, inMemory]) {
        for (let attempt = 0; attempt < 5; attempt++) await login(app);
        responses.push(await login(app));
      }
      const [fromPostgres, fromMemory] = responses;

      expect(fromPostgres!.statusCode).toBe(429);
      expect(fromMemory!.statusCode).toBe(429);
      expect(fromPostgres!.json()).toEqual(fromMemory!.json());
      for (const header of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'retry-after']) {
        expect(fromPostgres!.headers[header], header).toBe(fromMemory!.headers[header]);
      }
      expect(fromPostgres!.headers['x-ratelimit-reset']).toBeDefined();
    } finally {
      await inMemory.close();
    }
  });

  it('shares the public per-IP limit (30 per minute) across instances', async () => {
    const a = await instance();
    const b = await instance();

    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push((await share(i % 2 === 0 ? a : b)).statusCode);
    expect(statuses.every((status) => status === 404)).toBe(true);

    expect((await share(a)).statusCode).toBe(429);
  }, 60_000);

  it('counts the fixed-URL view (/public/t/:slug) in the same per-IP public bucket as the token view', async () => {
    const a = await instance();
    const b = await instance();

    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push((await share(i % 2 === 0 ? a : b)).statusCode);
    expect(statuses.every((status) => status === 404)).toBe(true);

    const bySlug = await a.inject({ method: 'GET', url: '/public/t/no-such-territory', remoteAddress: '127.0.0.1' });
    expect(bySlug.statusCode).toBe(429);
  }, 60_000);

  it('keeps every limit in its own bucket: exhausting sign-in does not limit the share view', async () => {
    const app = await instance();
    for (let attempt = 0; attempt < 6; attempt++) await login(app);
    expect((await login(app)).statusCode).toBe(429);

    expect((await share(app)).statusCode).toBe(404);
  });
});

describe('client IP behind Vercel (TRUST_PROXY=1)', () => {
  it('limits each forwarded client separately, even though all arrive from the same proxy address', async () => {
    const app = await instance({ TRUST_PROXY: '1' });
    const fromFirstClient = { headers: { 'x-forwarded-for': '203.0.113.10' } };
    const fromSecondClient = { headers: { 'x-forwarded-for': '203.0.113.20' } };

    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await login(app, fromFirstClient)).statusCode).toBe(401);
    }
    expect((await login(app, fromFirstClient)).statusCode).toBe(429);
    expect((await login(app, fromSecondClient)).statusCode).toBe(401);
  });
});

describe('PostgreSQL rate-limit store', () => {
  function storeOver(target: Pool, options = {}) {
    const Store = createPgRateLimitStore(target, options);
    // The plugin constructs the store with its options; this store ignores them.
    return new Store({}).child({} as never);
  }

  function incr(store: ReturnType<typeof storeOver>, key: string, timeWindow: number) {
    return new Promise<{ current: number; ttl: number }>((resolve, reject) => {
      store.incr(key, (error, result) => (error ? reject(error) : resolve(result!)), timeWindow, 5);
    });
  }

  it('counts within a window, reports the remaining time, and starts over once it has passed', async () => {
    const store = storeOver(pool);

    const first = await incr(store, 'window-test:1', 1_000);
    const second = await incr(store, 'window-test:1', 1_000);
    expect(first.current).toBe(1);
    expect(second.current).toBe(2);
    expect(first.ttl).toBeGreaterThan(0);
    expect(first.ttl).toBeLessThanOrEqual(1_000);
    expect(second.ttl).toBeLessThanOrEqual(first.ttl);

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const afterWindow = await incr(store, 'window-test:1', 1_000);
    expect(afterWindow.current).toBe(1);
  });

  it('increments atomically under concurrency: 25 parallel hits count 1 through 25', async () => {
    const store = storeOver(pool);

    const results = await Promise.all(Array.from({ length: 25 }, () => incr(store, 'concurrency-test:1', 60_000)));

    expect(results.map((result) => result.current).sort((x, y) => x - y)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1)
    );
  });

  it('stores only a hash of the key, never the client IP or share token itself', async () => {
    const app = await instance();
    await share(app, '192.0.2.77');

    const { rows } = await pool.query<{ key_hash: Buffer }>('SELECT key_hash FROM rate_limit_counters');
    const stored = rows.map((row) => row.key_hash.toString('hex'));
    expect(stored).toContain(hashRateLimitKey('public-ip:192.0.2.77').toString('hex'));

    const dump = await withClient((client) => client.query('SELECT * FROM rate_limit_counters'));
    expect(JSON.stringify(dump.rows)).not.toContain('192.0.2.77');
    expect(JSON.stringify(dump.rows)).not.toContain(UNKNOWN_TOKEN);
  });

  it('deletes expired counters and keeps live ones', async () => {
    const store = storeOver(pool);
    await incr(store, 'cleanup-test:expired', 1);
    await incr(store, 'cleanup-test:live', 60_000);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await deleteExpiredRateLimitCounters(pool)).toBe(1);

    const { rows } = await pool.query<{ key_hash: Buffer }>('SELECT key_hash FROM rate_limit_counters');
    expect(rows.map((row) => row.key_hash.toString('hex'))).toEqual([
      hashRateLimitKey('cleanup-test:live').toString('hex')
    ]);
  });

  it('cleans up on its own once the cleanup interval has passed', async () => {
    let clock = 0;
    const store = storeOver(pool, { cleanupIntervalMs: 1_000, now: () => clock });
    await incr(store, 'auto-cleanup-test:expired', 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    clock = 1_000;
    await incr(store, 'auto-cleanup-test:live', 60_000);

    await expect
      .poll(async () => (await pool.query('SELECT count(*)::int AS n FROM rate_limit_counters')).rows[0].n)
      .toBe(1);
  });
});

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}
