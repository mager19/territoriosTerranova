/**
 * Test helpers for the admin session boundary. Not a test file itself:
 * imported by route unit tests (with the in-memory store, no database) and
 * by integration tests (with the real PostgreSQL store, see
 * createPgAdminSessionStore).
 */

import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';

import type { AdminAuthConfig } from '../config.js';
import {
  ADMIN_SESSION_TTL_SECONDS,
  generateSessionToken,
  type AdminSession,
  type AdminSessionStore
} from '../auth/session-store.js';
import { ADMIN_SESSION_COOKIE } from '../auth/admin-guard.js';

export const TEST_ADMIN_EMAIL = 'admin@example.test';
export const SECOND_ADMIN_EMAIL = 'second-admin@example.test';
export const TEST_ADMIN_ORIGIN = 'https://admin.example.test';

export const TEST_ADMIN_PASSWORD = 'test-password-0123456789';
export const SECOND_ADMIN_PASSWORD = 'second-password-9876543210';

export function testAuthConfig(overrides: Partial<AdminAuthConfig> = {}): AdminAuthConfig {
  return {
    production: false,
    accounts: [
      { email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD },
      { email: SECOND_ADMIN_EMAIL, password: SECOND_ADMIN_PASSWORD }
    ],
    adminAppOrigin: TEST_ADMIN_ORIGIN,
    allowedOrigins: [TEST_ADMIN_ORIGIN],
    cookieSecure: true,
    ...overrides
  };
}

export interface InMemoryAdminSessionStore extends AdminSessionStore {
  /** Moves a live session's expiry into the past. */
  expire(token: string): void;
  readonly sessions: ReadonlyMap<string, AdminSession & { revoked: boolean }>;
}

/**
 * Same contract as the PostgreSQL store (null for unknown/revoked/expired),
 * keyed by plaintext token for test inspection. The PostgreSQL store's own
 * hashing, expiry, and revocation SQL is proven in
 * src/integration/admin-auth.test.ts.
 */
export function createInMemoryAdminSessionStore(): InMemoryAdminSessionStore {
  const sessions = new Map<string, AdminSession & { revoked: boolean }>();
  let nextId = 1;
  return {
    sessions,
    async create(email) {
      const token = generateSessionToken();
      const session = {
        id: nextId++,
        email: email.trim().toLowerCase(),
        expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000)
      };
      sessions.set(token, { ...session, revoked: false });
      return { token, session };
    },
    async resolve(token) {
      const entry = sessions.get(token);
      if (!entry || entry.revoked || entry.expiresAt.getTime() <= Date.now()) return null;
      return { id: entry.id, email: entry.email, expiresAt: entry.expiresAt };
    },
    async revoke(token) {
      const entry = sessions.get(token);
      if (entry) sessions.set(token, { ...entry, revoked: true });
    },
    expire(token) {
      const entry = sessions.get(token);
      if (entry) sessions.set(token, { ...entry, expiresAt: new Date(Date.now() - 1000) });
    }
  };
}

/** Creates a session in `store` and returns the matching Cookie header value. */
export async function sessionCookieFor(store: AdminSessionStore, email: string = TEST_ADMIN_EMAIL): Promise<string> {
  const { token } = await store.create(email);
  return `${ADMIN_SESSION_COOKIE}=${token}`;
}

export interface AuthenticatedClient {
  inject(options: InjectOptions): Promise<LightMyRequestResponse>;
}

/** Wraps app.inject so every request carries the given session cookie. */
export function asAdmin(app: FastifyInstance, cookie: string): AuthenticatedClient {
  return {
    inject(options) {
      return app.inject({ ...options, headers: { ...options.headers, cookie } });
    }
  };
}
