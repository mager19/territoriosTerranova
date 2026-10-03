/**
 * Administrator sign-in, session introspection, and sign-out
 * (docs/admin-auth.md). The session guard (auth/admin-guard.ts) protects
 * /admin/me and /admin/logout; /admin/auth/login is the only
 * unauthenticated /admin route.
 */

import type { FastifyInstance, onRequestHookHandler } from 'fastify';

import type { AdminAuthConfig } from '../../config.js';
import {
  ADMIN_SESSION_COOKIE,
  clearSessionCookie,
  sessionEmail,
  setSessionCookie
} from '../../auth/admin-guard.js';
import { verifyAdminCredentials } from '../../auth/credentials.js';
import { ADMIN_SESSION_TTL_SECONDS, type AdminSessionStore } from '../../auth/session-store.js';
import { isRecord } from './error-response.js';

export interface AdminAuthRouteDeps {
  readonly config: AdminAuthConfig;
  readonly sessions: AdminSessionStore;
  /** Strict per-IP limit for sign-in attempts (@fastify/rate-limit, registered once in app.ts). */
  readonly loginRateLimit: onRequestHookHandler;
  /** Looser limit for sign-out. */
  readonly logoutRateLimit: onRequestHookHandler;
}

export function registerAdminAuthRoutes(app: FastifyInstance, deps: AdminAuthRouteDeps): void {
  const cookieOptions = { secure: deps.config.cookieSecure };

  app.post('/admin/auth/login', { onRequest: deps.loginRateLimit }, async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {};
    const email = verifyAdminCredentials(deps.config.accounts, body.email, body.password);
    if (email === null) {
      // One response for an unknown email, a wrong password, and malformed
      // input alike: nothing tells an attacker which part was wrong.
      return reply.status(401).send({ error: 'invalid_credentials' });
    }
    const { token } = await deps.sessions.create(email);
    setSessionCookie(reply, token, ADMIN_SESSION_TTL_SECONDS, cookieOptions);
    return reply.status(200).send({ email });
  });

  app.get('/admin/me', async (request, reply) => {
    return reply.status(200).send({ email: sessionEmail(request) });
  });

  app.post('/admin/logout', { onRequest: deps.logoutRateLimit }, async (request, reply) => {
    const token = request.cookies[ADMIN_SESSION_COOKIE];
    if (token) await deps.sessions.revoke(token);
    clearSessionCookie(reply, cookieOptions);
    return reply.status(204).send();
  });
}
