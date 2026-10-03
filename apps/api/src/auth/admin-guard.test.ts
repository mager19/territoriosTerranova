/**
 * The admin session boundary at the HTTP layer, without a database: the
 * session store is the in-memory test double and the pool throws if any
 * request reaches it. The PostgreSQL session store (hashing, expiry,
 * revocation in SQL) and actor = session email are proven against real
 * PostGIS in src/integration/admin-auth.test.ts.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../app.js';
import type { AdminAuthConfig } from '../config.js';
import type { TransactionalPool } from '../db/transaction.js';
import {
  SECOND_ADMIN_EMAIL,
  SECOND_ADMIN_PASSWORD,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_ORIGIN,
  TEST_ADMIN_PASSWORD,
  createInMemoryAdminSessionStore,
  sessionCookieFor,
  testAuthConfig,
  type InMemoryAdminSessionStore
} from '../test-support/admin-auth.js';

const poisonPool: TransactionalPool = {
  connect: async () => {
    throw new Error('this request must not reach the database');
  }
};

let app: FastifyInstance | undefined;
let store: InMemoryAdminSessionStore;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function buildTestApp(config: Partial<AdminAuthConfig> = {}): Promise<FastifyInstance> {
  store = createInMemoryAdminSessionStore();
  app = await buildApp(
    {
      queryPostgisVersion: async () => '3.4.3',
      pool: poisonPool,
      auth: { config: testAuthConfig(config), sessions: store }
    },
    { logger: false }
  );
  return app;
}

/**
 * Every registered /admin route as "METHOD /full/path", read from Fastify's
 * own route tree (printRoutes nests child segments under their parent,
 * four characters of tree drawing per level).
 */
function registeredAdminRoutes(instance: FastifyInstance): string[] {
  const routes: string[] = [];
  const stack: string[] = [];
  for (const line of instance.printRoutes({ commonPrefix: false }).split('\n')) {
    const match = /^([│├└─\s]*)(\S+) \(([^)]+)\)$/.exec(line);
    if (!match) continue;
    const [, drawing, segment, methods] = match as unknown as [string, string, string, string];
    const depth = drawing.length / 4 - 1;
    stack.length = depth;
    const path = (stack[depth - 1] ?? '') + segment;
    stack[depth] = path;
    if (!path.startsWith('/admin')) continue;
    for (const method of methods.split(',').map((m) => m.trim())) {
      if (method !== 'HEAD') routes.push(`${method} ${path}`);
    }
  }
  return routes;
}

function login(instance: FastifyInstance, payload: unknown, headers: Record<string, string> = {}) {
  return instance.inject({ method: 'POST', url: '/admin/auth/login', payload: payload as object, headers });
}

describe('admin session guard', () => {
  it('answers 401 without a session on EVERY registered /admin route except sign-in', async () => {
    const instance = await buildTestApp();
    const routes = registeredAdminRoutes(instance);

    // Representative routes of every admin route module must be in the table.
    expect(routes).toEqual(
      expect.arrayContaining([
        'GET /admin/territories',
        'POST /admin/territories',
        'GET /admin/territories/:id',
        'GET /admin/territories/:id/audit',
        'POST /admin/territories/:id/revisions',
        'PATCH /admin/territories/:id/number',
        'GET /admin/territories/overview',
        'GET /admin/territories/:id/operational-state',
        'POST /admin/territories/:id/operational-state',
        'GET /admin/territories/:id/cycles',
        'GET /admin/territories/:id/progress',
        'POST /admin/territories/:id/progress',
        'POST /admin/territories/:id/share-tokens',
        'POST /admin/share-tokens/:id/revoke',
        'GET /admin/reference/barrios',
        'GET /admin/me',
        'POST /admin/logout',
        'POST /admin/auth/login'
      ])
    );

    const guarded = routes.filter((route) => route !== 'POST /admin/auth/login');
    expect(guarded.length).toBeGreaterThanOrEqual(17);
    for (const route of guarded) {
      const [method, path] = route.split(' ') as [string, string];
      const response = await instance.inject({
        method: method as 'GET',
        url: `${path.replaceAll(':id', '1')}?name=x`,
        payload: method === 'GET' ? undefined : {}
      });
      expect({ route, status: response.statusCode, body: response.json() }).toEqual({
        route,
        status: 401,
        body: { error: 'unauthorized' }
      });
    }
  });

  it('rejects an unknown session token', async () => {
    const instance = await buildTestApp();
    const response = await instance.inject({
      method: 'GET',
      url: '/admin/territories',
      headers: { cookie: 'admin_session=not-a-real-session' }
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an expired session', async () => {
    const instance = await buildTestApp();
    const cookie = await sessionCookieFor(store);
    store.expire(cookie.split('=')[1] as string);
    const response = await instance.inject({ method: 'GET', url: '/admin/me', headers: { cookie } });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a revoked session', async () => {
    const instance = await buildTestApp();
    const cookie = await sessionCookieFor(store);
    await store.revoke(cookie.split('=')[1] as string);
    const response = await instance.inject({ method: 'GET', url: '/admin/me', headers: { cookie } });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a live session whose account was removed from the configuration', async () => {
    const instance = await buildTestApp({ accounts: [{ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }] });
    const removed = await sessionCookieFor(store, SECOND_ADMIN_EMAIL);
    const response = await instance.inject({ method: 'GET', url: '/admin/me', headers: { cookie: removed } });
    expect(response.statusCode).toBe(401);
  });

  it('lets a valid session through to the route handler', async () => {
    const instance = await buildTestApp();
    const cookie = await sessionCookieFor(store);
    // A validation 400 proves the handler ran (the guard passed) without touching the database.
    const response = await instance.inject({
      method: 'GET',
      url: '/admin/territories/not-a-number',
      headers: { cookie }
    });
    expect(response.statusCode).toBe(400);
  });

  it('never accepts a share token or any other bearer credential in place of a session', async () => {
    const instance = await buildTestApp();
    const response = await instance.inject({
      method: 'GET',
      url: '/admin/territories',
      headers: { authorization: 'Bearer some-share-token', cookie: 'share_token=abc' }
    });
    expect(response.statusCode).toBe(401);
  });

  it('leaves public routes and /health untouched', async () => {
    const instance = await buildTestApp();
    const health = await instance.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    // The poison pool throws once the public handler runs: 500, not 401.
    const publicView = await instance.inject({ method: 'GET', url: '/public/territories/some-token' });
    expect(publicView.statusCode).toBe(500);
  });
});

describe('admin CSRF Origin check', () => {
  it('rejects a state-changing request from a foreign Origin, even with a valid session', async () => {
    const instance = await buildTestApp();
    const cookie = await sessionCookieFor(store);
    for (const method of ['POST', 'PATCH'] as const) {
      const response = await instance.inject({
        method,
        url: method === 'POST' ? '/admin/territories/not-a-number/progress' : '/admin/territories/not-a-number/number',
        headers: { cookie, origin: 'https://evil.example' },
        payload: {}
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'forbidden_origin' });
    }
  });

  it('rejects the literal "null" Origin on a state-changing request', async () => {
    const instance = await buildTestApp();
    const cookie = await sessionCookieFor(store);
    const response = await instance.inject({
      method: 'POST',
      url: '/admin/logout',
      headers: { cookie, origin: 'null' }
    });
    expect(response.statusCode).toBe(403);
  });

  it('applies to sign-in too (no login CSRF)', async () => {
    const instance = await buildTestApp();
    const response = await login(
      instance,
      { email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD },
      { origin: 'https://evil.example' }
    );
    expect(response.statusCode).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('accepts a state-changing request from the admin origin or with no Origin header', async () => {
    const instance = await buildTestApp();
    const cookie = await sessionCookieFor(store);
    const allowed = await instance.inject({
      method: 'POST',
      url: '/admin/territories/not-a-number/progress',
      headers: { cookie, origin: TEST_ADMIN_ORIGIN },
      payload: {}
    });
    expect(allowed.statusCode).toBe(400);
    const noOrigin = await instance.inject({
      method: 'POST',
      url: '/admin/territories/not-a-number/progress',
      headers: { cookie },
      payload: {}
    });
    expect(noOrigin.statusCode).toBe(400);
  });

  it('does not apply to safe (GET) requests', async () => {
    const instance = await buildTestApp();
    const cookie = await sessionCookieFor(store);
    const response = await instance.inject({
      method: 'GET',
      url: '/admin/me',
      headers: { cookie, origin: 'https://evil.example' }
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('POST /admin/auth/login', () => {
  it('signs in with the hardened session cookie and returns only the email', async () => {
    const instance = await buildTestApp();
    const response = await login(instance, { email: 'Admin@Example.TEST', password: TEST_ADMIN_PASSWORD });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ email: TEST_ADMIN_EMAIL });
    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toMatch(/^admin_session=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=604800');

    const cookie = setCookie.split(';')[0] as string;
    const me = await instance.inject({ method: 'GET', url: '/admin/me', headers: { cookie } });
    expect(me.json()).toEqual({ email: TEST_ADMIN_EMAIL });
  });

  it('signs in the second account as itself', async () => {
    const instance = await buildTestApp();
    const response = await login(instance, { email: SECOND_ADMIN_EMAIL, password: SECOND_ADMIN_PASSWORD });
    expect(response.json()).toEqual({ email: SECOND_ADMIN_EMAIL });
  });

  it('omits Secure only when the configuration says the admin app runs over plain http', async () => {
    const instance = await buildTestApp({ cookieSecure: false });
    const response = await login(instance, { email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD });
    expect(String(response.headers['set-cookie'])).not.toContain('Secure');
  });

  it('answers a wrong password, an unknown email, and malformed input with the identical 401', async () => {
    const instance = await buildTestApp();
    const attempts = [
      { email: TEST_ADMIN_EMAIL, password: 'wrong-password-000' },
      { email: 'stranger@example.test', password: TEST_ADMIN_PASSWORD },
      { email: TEST_ADMIN_EMAIL, password: SECOND_ADMIN_PASSWORD },
      { email: TEST_ADMIN_EMAIL }
    ];
    const responses = [];
    for (const attempt of attempts) {
      responses.push(await login(instance, attempt));
    }
    for (const response of responses) {
      expect(response.statusCode).toBe(401);
      expect(response.body).toBe(JSON.stringify({ error: 'invalid_credentials' }));
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    expect(store.sessions.size).toBe(0);
  });

  it('rate-limits sign-in attempts per client: the sixth attempt in 15 minutes gets 429', async () => {
    const instance = await buildTestApp();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await login(instance, { email: TEST_ADMIN_EMAIL, password: 'wrong-password-000' });
      expect(response.statusCode).toBe(401);
    }
    const blocked = await login(instance, { email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['set-cookie']).toBeUndefined();
    expect(store.sessions.size).toBe(0);
  });

  it('rejects everyone when no account is configured', async () => {
    const instance = await buildTestApp({ accounts: [] });
    const response = await login(instance, { email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /admin/me and POST /admin/logout', () => {
  it('returns only the signed-in email', async () => {
    const instance = await buildTestApp();
    const cookie = await sessionCookieFor(store);
    const response = await instance.inject({ method: 'GET', url: '/admin/me', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ email: TEST_ADMIN_EMAIL });
  });

  it('logout revokes the session and clears the cookie', async () => {
    const instance = await buildTestApp();
    const cookie = await sessionCookieFor(store);
    const token = cookie.split('=')[1] as string;

    const response = await instance.inject({ method: 'POST', url: '/admin/logout', headers: { cookie } });
    expect(response.statusCode).toBe(204);
    expect(store.sessions.get(token)?.revoked).toBe(true);
    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toMatch(/^admin_session=;/);
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970/);

    const after = await instance.inject({ method: 'GET', url: '/admin/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });
});

describe('buildApp wiring', () => {
  it('refuses to register admin routes without the auth dependencies', async () => {
    await expect(buildApp({ queryPostgisVersion: async () => '3.4.3', pool: poisonPool }, { logger: false })).rejects.toThrow(
      /auth/
    );
  });
});
