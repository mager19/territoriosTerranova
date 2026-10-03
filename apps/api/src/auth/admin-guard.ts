/**
 * The administrator boundary (AGENTS.md "Architecture guardrails"): every
 * /admin route requires a session for one of the env-configured admin
 * accounts, except the sign-in route itself.
 *
 * Attached per route through Fastify's onRoute hook, keyed on the route's
 * declared URL — not on the raw request path — so an encoded or otherwise
 * unusual request path that still matches an /admin route can never slip
 * past a string-prefix check. Must be registered BEFORE any admin route.
 *
 * A share token is never accepted here: the only credential is the
 * admin_session cookie, resolved against admin_sessions.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest, onRequestHookHandler } from 'fastify';

import type { AdminSession, AdminSessionStore } from './session-store.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the admin guard on every guarded /admin route; null elsewhere. */
    adminSession: AdminSession | null;
  }
}

export const ADMIN_SESSION_COOKIE = 'admin_session';

/** /admin routes reachable without a session. Everything else under /admin is guarded. */
export const UNAUTHENTICATED_ADMIN_ROUTES: ReadonlySet<string> = new Set(['/admin/auth/login']);

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface AdminGuardOptions {
  readonly sessions: AdminSessionStore;
  readonly allowedOrigins: readonly string[];
}

function isAdminUrl(url: string): boolean {
  return url === '/admin' || url.startsWith('/admin/');
}

export function registerAdminGuard(app: FastifyInstance, options: AdminGuardOptions): void {
  app.decorateRequest('adminSession', null);

  /**
   * CSRF defense in depth on top of SameSite=Strict: a state-changing
   * request that announces a foreign Origin (including the opaque "null")
   * is refused. Requests without an Origin header (non-browser clients,
   * same-origin navigations in older browsers) still need a session.
   */
  const checkOrigin: onRequestHookHandler = async (request, reply) => {
    if (!STATE_CHANGING_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin !== undefined && !options.allowedOrigins.includes(origin)) {
      return reply.status(403).send({ error: 'forbidden_origin' });
    }
  };

  const requireSession: onRequestHookHandler = async (request, reply) => {
    const token = request.cookies[ADMIN_SESSION_COOKIE];
    const session = token ? await options.sessions.resolve(token) : null;
    if (session === null) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
    request.adminSession = session;
  };

  app.addHook('onRoute', (route) => {
    if (!isAdminUrl(route.url)) return;
    const existing = route.onRequest === undefined ? [] : Array.isArray(route.onRequest) ? route.onRequest : [route.onRequest];
    // Fastify re-runs onRoute for the auto-generated HEAD sibling of a GET
    // route with the already-augmented options: never stack twice.
    if (existing.includes(checkOrigin)) return;
    const guards = UNAUTHENTICATED_ADMIN_ROUTES.has(route.url) ? [checkOrigin] : [checkOrigin, requireSession];
    route.onRequest = [...guards, ...existing];
  });
}

/**
 * The actor for every admin write: the session email, never a
 * client-provided field. Throws if called on a route the guard did not
 * protect — a programming error, never a request-dependent outcome.
 */
export function sessionEmail(request: FastifyRequest): string {
  if (request.adminSession === null) {
    throw new Error('admin session missing: this route is not behind the admin guard');
  }
  return request.adminSession.email;
}

export interface SessionCookieOptions {
  readonly secure: boolean;
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresInSeconds: number, options: SessionCookieOptions): void {
  void reply.setCookie(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'strict',
    path: '/',
    maxAge: expiresInSeconds
  });
}

export function clearSessionCookie(reply: FastifyReply, options: SessionCookieOptions): void {
  void reply.clearCookie(ADMIN_SESSION_COOKIE, {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'strict',
    path: '/'
  });
}
