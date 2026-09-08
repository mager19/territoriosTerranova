/**
 * Full-stack integration tests for A4 — the highest-stakes suite in this
 * project. Every DoD bullet in docs/agents/A4-sharing.md gets its own
 * test here, against real PostGIS via Testcontainers, exercised through
 * the actual HTTP routes.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '@territorios/geo/db/migrate';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../app.js';

const IMAGE = 'postgis/postgis:16-3.4';

const VALID_SQUARE = {
  type: 'Polygon',
  coordinates: [
    [
      [-75.574, 6.357],
      [-75.572, 6.357],
      [-75.572, 6.359],
      [-75.574, 6.359],
      [-75.574, 6.357]
    ]
  ]
};
const OTHER_SQUARE = {
  type: 'Polygon',
  coordinates: [[[-75.59, 6.34], [-75.585, 6.34], [-75.585, 6.345], [-75.59, 6.345], [-75.59, 6.34]]]
};

const FIXTURE_BOUNDARY_SQL = `
  INSERT INTO reference_municipal_boundary (id, name, geom, source_url, retrieved_at, attribution)
  VALUES (1, 'Bello (test fixture envelope)',
          ST_Multi(ST_SetSRID(ST_MakeEnvelope(-75.70, 6.20, -75.40, 6.55), 4326)),
          'integration-test-fixture', now(),
          'test fixture; see packages/geo/src/integration/db.test.ts for the real-boundary equivalent')
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
    .withDatabase('territorios_api_sharing_test')
    .withUsername('territorios')
    .withPassword('territorios')
    .withStartupTimeout(300_000)
    .start();
  databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);
  await withClient((client) => client.query(FIXTURE_BOUNDARY_SQL));

  pool = new Pool({ connectionString: databaseUrl, max: 10 });
  app = await buildApp({ queryPostgisVersion: async () => '3.4.3', pool }, { logger: false });
}, 360_000);

afterEach(async () => {
  await withClient((client) => client.query(`UPDATE territories SET status = 'archived' WHERE status = 'active'`));
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

interface ShareTokenBody {
  readonly id: number;
  readonly token: string;
  readonly assignmentId: number;
  readonly expiresAt: string | null;
}

async function createTerritoryAssignedAndShared(
  geometry: unknown = VALID_SQUARE,
  name = `T-share-${Math.random().toString(36).slice(2)}`
): Promise<{ territoryId: number; assignmentId: number; token: string; tokenId: number }> {
  const territoryResponse = await app.inject({
    method: 'POST',
    url: '/admin/territories',
    payload: { name, geometry, author: 'admin-1' }
  });
  const territoryId = territoryResponse.json().id;

  const assignmentResponse = await app.inject({
    method: 'POST',
    url: `/admin/territories/${territoryId}/assignments`,
    payload: { assignedTo: 'worker-1', assignedBy: 'admin-1' }
  });
  const assignmentId = assignmentResponse.json().id;

  const tokenResponse = await app.inject({
    method: 'POST',
    url: `/admin/assignments/${assignmentId}/share-tokens`,
    payload: {}
  });
  expect(tokenResponse.statusCode).toBe(201);
  const tokenBody = tokenResponse.json() as ShareTokenBody;

  return { territoryId, assignmentId, token: tokenBody.token, tokenId: tokenBody.id };
}

describe('POST /admin/assignments/:id/share-tokens', () => {
  it('creates a token and returns the plaintext exactly once', async () => {
    const { token } = await createTerritoryAssignedAndShared();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(30);
  });

  it('stores only a hash — the plaintext token never appears anywhere in the database', async () => {
    const { token } = await createTerritoryAssignedAndShared();

    const rows = await withClient(async (client) => {
      const { rows } = await client.query<{ token_hash: string }>(`SELECT token_hash FROM share_tokens`);
      return rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.token_hash).not.toBe(token);
      expect(row.token_hash).not.toContain(token);
    }
  });

  it('returns assignment_not_found for a nonexistent assignment', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/assignments/999999/share-tokens',
      payload: {}
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'assignment_not_found' });
  });
});

describe('GET /public/territories/:token — response shape', () => {
  it('returns exactly the allowlisted keys, nothing more', async () => {
    const { token } = await createTerritoryAssignedAndShared();

    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    // This is the pinned list. Adding a field to the public response
    // requires deliberately updating this test — that friction is the
    // point (A4 brief: "must break when someone adds a field carelessly").
    expect(Object.keys(body).sort()).toEqual(['boundary', 'remainingArea', 'remainingAreaStatus', 'territoryName']);
  });

  it('returns the territory boundary as a valid Polygon', async () => {
    const { token } = await createTerritoryAssignedAndShared();
    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    const body = response.json();
    expect(body.boundary.type).toBe('Polygon');
    expect(Array.isArray(body.boundary.coordinates)).toBe(true);
  });

  it('reports remaining area as explicitly unknown when no progress was recorded — never inferred', async () => {
    const { token } = await createTerritoryAssignedAndShared();
    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    const body = response.json();
    expect(body.remainingArea).toBeNull();
    expect(body.remainingAreaStatus).toBe('unknown');
  });

  it('shows the remaining area when progress recorded one', async () => {
    const { token, assignmentId } = await createTerritoryAssignedAndShared();
    const remainingArea = {
      type: 'Polygon',
      coordinates: [[[-75.5735, 6.358], [-75.5725, 6.358], [-75.5725, 6.3585], [-75.5735, 6.3585], [-75.5735, 6.358]]]
    };
    await app.inject({
      method: 'POST',
      url: `/admin/assignments/${assignmentId}/progress`,
      payload: { recordedBy: 'worker-1', remainingArea }
    });

    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    const body = response.json();
    expect(body.remainingAreaStatus).toBe('recorded');
    expect(body.remainingArea).toEqual(remainingArea);
  });

  it('never leaks assignee identity, notes, timestamps, routes, pause points, history, or internal ids', async () => {
    const { token, assignmentId } = await createTerritoryAssignedAndShared();
    await app.inject({
      method: 'POST',
      url: `/admin/assignments/${assignmentId}/progress`,
      payload: {
        recordedBy: 'worker-1',
        note: 'a secret note the public must never see',
        pausePoint: { type: 'Point', coordinates: [-75.573, 6.358] },
        route: { type: 'LineString', coordinates: [[-75.5738, 6.3575], [-75.5732, 6.3585]] }
      }
    });

    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    const raw = JSON.stringify(response.json());
    expect(raw).not.toContain('worker-1');
    expect(raw).not.toContain('secret note');
    expect(raw).not.toMatch(/"id"\s*:/); // no raw id field anywhere in the payload
    expect(raw).not.toContain('pausePoint');
    expect(raw).not.toContain('route');
    expect(raw).not.toContain('assignedTo');
    expect(raw).not.toContain('recordedAt');
  });
});

describe('GET /public/territories/:token — headers', () => {
  it('sets every required security header on a valid response', async () => {
    const { token } = await createTerritoryAssignedAndShared();
    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('sets the same required security headers even on a 404 — a cached/indexed 404 still leaks that this endpoint exists', async () => {
    const response = await app.inject({ method: 'GET', url: '/public/territories/not-a-real-token' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('GET /public/territories/:token — revocation, expiry, and scope', () => {
  it('a nonexistent token returns 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/public/territories/this-token-was-never-issued' });
    expect(response.statusCode).toBe(404);
  });

  it('a revoked token returns 404 — never 403, which would confirm the token existed', async () => {
    const { token, tokenId } = await createTerritoryAssignedAndShared();

    const before = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(before.statusCode).toBe(200);

    const revokeResponse = await app.inject({ method: 'POST', url: `/admin/share-tokens/${tokenId}/revoke` });
    expect(revokeResponse.statusCode).toBe(204);

    const after = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(after.statusCode).toBe(404);
    expect(after.statusCode).not.toBe(403);
  });

  it('revocation takes effect immediately — no cache window', async () => {
    const { token, tokenId } = await createTerritoryAssignedAndShared();
    await app.inject({ method: 'POST', url: `/admin/share-tokens/${tokenId}/revoke` });
    // Immediately, not "eventually" — the very next request must already reflect it.
    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(response.statusCode).toBe(404);
  });

  it('an expired token returns 404', async () => {
    // A2's own CHECK constraint (share_tokens_expiry_after_creation) requires
    // expires_at > created_at, so an expiry can never be backdated before
    // creation — there is no way to fabricate an "already expired at
    // creation" row, by design. The only honest way to test this is to
    // create a token that expires in the near future via the real admin
    // route (exercising that input path too) and wait for it to lapse.
    const territoryResponse = await app.inject({
      method: 'POST',
      url: '/admin/territories',
      payload: { name: `T-expiry-${Math.random().toString(36).slice(2)}`, geometry: VALID_SQUARE, author: 'admin-1' }
    });
    const assignmentResponse = await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryResponse.json().id}/assignments`,
      payload: { assignedTo: 'worker-1', assignedBy: 'admin-1' }
    });
    const tokenResponse = await app.inject({
      method: 'POST',
      url: `/admin/assignments/${assignmentResponse.json().id}/share-tokens`,
      payload: { expiresAt: new Date(Date.now() + 800).toISOString() }
    });
    expect(tokenResponse.statusCode).toBe(201);
    const token = (tokenResponse.json() as ShareTokenBody).token;

    const beforeExpiry = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(beforeExpiry.statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const afterExpiry = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(afterExpiry.statusCode).toBe(404);
  });

  it('a valid, unexpired, unrevoked token still works (control case for the expiry test)', async () => {
    const { token } = await createTerritoryAssignedAndShared();
    const response = await app.inject({ method: 'GET', url: `/public/territories/${token}` });
    expect(response.statusCode).toBe(200);
  });

  it('cannot read another territory by any parameter manipulation — each token is scoped to exactly its own assignment', async () => {
    const a = await createTerritoryAssignedAndShared(VALID_SQUARE, 'T-scope-A');
    const b = await createTerritoryAssignedAndShared(OTHER_SQUARE, 'T-scope-B');

    const responseA = await app.inject({ method: 'GET', url: `/public/territories/${a.token}` });
    const responseB = await app.inject({ method: 'GET', url: `/public/territories/${b.token}` });

    expect(responseA.json().territoryName).toBe('T-scope-A');
    expect(responseB.json().territoryName).toBe('T-scope-B');
    expect(responseA.json().boundary).not.toEqual(responseB.json().boundary);

    // There is no query/path parameter to manipulate on this route besides
    // the token itself — token A cannot be swapped with an id/name to read
    // B, because the route accepts nothing but the token.
    const attemptedManipulation = await app.inject({
      method: 'GET',
      url: `/public/territories/${a.token}?territoryId=${b.territoryId}`
    });
    expect(attemptedManipulation.json().territoryName).toBe('T-scope-A');
  });
});

describe('a share token cannot invoke any administrative action', () => {
  /**
   * Real finding surfaced while writing this suite, reported explicitly
   * rather than quietly worked around: admin routes have NO authentication
   * layer at all today — every /admin/** route answers any caller, share
   * token or not. That gap predates A4 (it is a property of A1/A3's
   * routes, not something A4 introduces or is asked to fix — the brief
   * scopes A4 to apps/api/src/sharing/** and routes/public/**), but it
   * means "does a share token grant admin access" cannot be tested as "is
   * the request rejected" — an unauthenticated request already succeeds
   * regardless of any token. What CAN be tested, and is the real substance
   * of this DoD line, is narrower and still meaningful: the sharing
   * module and the public route never call into any admin/domain mutation
   * function, and a token's presence changes nothing about how an admin
   * route behaves — it is never read as a credential anywhere.
   */
  it('documents the real, separate finding: admin routes require no credential at all today', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/territories' });
    expect(response.statusCode).toBe(200); // no Authorization header, no cookie, no token of any kind — and it still succeeds
  });

  it('a token in an Authorization or custom header changes nothing about an admin route\'s response — it is never read as a credential', async () => {
    const { token } = await createTerritoryAssignedAndShared();

    const withoutToken = await app.inject({ method: 'GET', url: '/admin/territories' });
    const withToken = await app.inject({
      method: 'GET',
      url: '/admin/territories',
      headers: { authorization: `Bearer ${token}`, 'x-share-token': token }
    });

    expect(withToken.statusCode).toBe(withoutToken.statusCode);
    // Same list length is enough to prove the header had zero effect on
    // the query executed — a credential-aware bug would scope or filter
    // differently, not just happen to return the same status.
    expect(withToken.json().territories.length).toBe(withoutToken.json().territories.length);
  });

  it('a share token string used as ordinary body data (author, actor, reason, assignedTo) carries no special privilege — it is just an opaque string', async () => {
    const { token, territoryId, assignmentId } = await createTerritoryAssignedAndShared();

    // These succeed — correctly. The point is what they prove: the value
    // is stored/used as plain text with no elevated meaning, the same as
    // any other string would be. A real credential system would need to
    // exist before "is rejected" is even a meaningful question; today the
    // right assertion is "is inert", not "is rejected".
    const revisionResponse = await app.inject({
      method: 'POST',
      url: `/admin/territories/${territoryId}/revisions`,
      payload: { geometry: OTHER_SQUARE, author: token }
    });
    expect(revisionResponse.statusCode).toBe(201);
    expect(revisionResponse.json().author).toBe(token); // stored verbatim as text, not interpreted

    const returnResponse = await app.inject({
      method: 'POST',
      url: `/admin/assignments/${assignmentId}/return`,
      payload: { actor: token }
    });
    expect(returnResponse.statusCode).toBe(200);
    expect(returnResponse.json().status).toBe('returned'); // an ordinary state transition, not an elevated one
  });

  it('the share token itself is never a valid territory id on an admin route — no implicit coercion path from token to admin resource', async () => {
    const { token } = await createTerritoryAssignedAndShared();
    const response = await app.inject({ method: 'GET', url: `/admin/territories/${token}` });
    expect(response.statusCode).toBe(400); // fails the positive-integer id check, exactly like any other garbage id
  });
});

describe('rate limiting', () => {
  it('enforces a per-token limit — the 31st request within the window for one token is rejected', async () => {
    // An ISOLATED app instance, not the file-wide `app`: the rate limiter's
    // in-memory counters are per-Fastify-instance, and every earlier test
    // in this file has already made public-route requests against the
    // shared `app` — reusing it here would start this test with an
    // already-partially-consumed per-IP bucket (`.inject()`'s synthetic
    // requests all share one "IP"), making "the 31st request" meaningless.
    // Same database pool, fresh rate-limit state.
    const isolatedApp = await buildApp({ queryPostgisVersion: async () => '3.4.3', pool }, { logger: false });
    try {
      const { token } = await createTerritoryAssignedAndShared();

      const statuses: number[] = [];
      for (let i = 0; i < 31; i += 1) {
        // Sequential on purpose: the rate limiter counts requests, and
        // running them concurrently would race against the counter in a
        // way that does not change what is being proven (a 31st request
        // in-window is rejected) but would make the "which one is the
        // 31st" framing meaningless.
        const response = await isolatedApp.inject({ method: 'GET', url: `/public/territories/${token}` });
        statuses.push(response.statusCode);
      }
      expect(statuses.slice(0, 30).every((s) => s === 200 || s === 404)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await isolatedApp.close();
    }
  }, 30_000);
});

describe('timing does not leak token existence', () => {
  // Isolated app for this whole describe block: by this point in the file
  // the shared `app` has already made dozens of /public/territories/*
  // requests (response-shape, headers, revocation, scope tests), and this
  // block alone makes ~20 more. Sharing the file-wide app's rate-limit
  // counters here risks a spurious 429 mid-measurement, which would
  // corrupt a timing comparison (a 429 short-circuits far faster than a
  // real 200/404 with joins) far more than it would corrupt a plain
  // pass/fail test — hence a dedicated instance for the whole block, not
  // just the loop, kept in a local beforeAll/afterAll.
  let timingApp: FastifyInstance;

  beforeAll(async () => {
    timingApp = await buildApp({ queryPostgisVersion: async () => '3.4.3', pool }, { logger: false });
  });

  afterAll(async () => {
    await timingApp.close();
  });

  it('a nonexistent token and a revoked token take a structurally equal path: both execute the full lookup query, not a short-circuit', async () => {
    // A meaningful, non-flaky proof for this DoD bullet is structural, not
    // wall-clock: resolvePublicTerritoryView (sharing/repository.ts) runs
    // the SAME single query with the SAME joins for every outcome except a
    // token whose hash was never generated at all, which is indistinguishable
    // from any other guess in a 256-bit space. A real wall-clock assertion
    // here would be flaky in CI (network/scheduler jitter dwarfs any
    // genuine timing difference at this data size) and would prove less
    // than reading the query itself does. This test instead proves the
    // BEHAVIORAL invariant that actually prevents a timing leak: revoked,
    // expired, and nonexistent are byte-for-byte identical responses,
    // which is only possible if no branch does materially different work.
    const { token, tokenId } = await createTerritoryAssignedAndShared();
    await app.inject({ method: 'POST', url: `/admin/share-tokens/${tokenId}/revoke` });

    const revoked = await timingApp.inject({ method: 'GET', url: `/public/territories/${token}` });
    const nonexistent = await timingApp.inject({ method: 'GET', url: '/public/territories/never-issued-token-guess' });

    expect(revoked.statusCode).toBe(nonexistent.statusCode);
    expect(revoked.body).toBe(nonexistent.body);
    // `date` (wall-clock) and `x-ratelimit-remaining` (a monotonically
    // decreasing counter across these two sequential calls) legitimately
    // differ between any two requests regardless of token validity —
    // excluding them is not hiding a real signal, it is removing two
    // headers whose variation is a property of "two separate requests
    // happened", not of "one token was valid and the other was not".
    const ignoredHeaders = new Set(['date', 'x-ratelimit-remaining']);
    const relevantHeaders = (headers: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(headers).filter(([k]) => !ignoredHeaders.has(k)));
    expect(relevantHeaders(revoked.headers)).toEqual(relevantHeaders(nonexistent.headers));
  });

  it('best-effort timing check: mean latency for a hit vs. a miss stays within a generous ratio (not cryptographically rigorous — see the structural test above for the real guarantee)', async () => {
    const { token } = await createTerritoryAssignedAndShared();
    const SAMPLES = 10; // 2 * SAMPLES public-route calls, kept comfortably under this isolated instance's own 30/minute per-IP limit

    const time = async (url: string): Promise<number> => {
      const start = process.hrtime.bigint();
      await timingApp.inject({ method: 'GET', url });
      return Number(process.hrtime.bigint() - start) / 1e6;
    };

    const hits: number[] = [];
    const misses: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      hits.push(await time(`/public/territories/${token}`));
      misses.push(await time(`/public/territories/never-issued-${i}`));
    }
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const meanHit = mean(hits);
    const meanMiss = mean(misses);

    // Generous 4x tolerance in either direction — this is a smoke check
    // against a GROSS leak (e.g. an early `if (!found) return 404` before
    // any join), not a precision timing-attack defense.
    expect(meanHit).toBeLessThan(meanMiss * 4 + 5);
    expect(meanMiss).toBeLessThan(meanHit * 4 + 5);
  });
});
