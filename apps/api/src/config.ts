export interface AdminAccount {
  /** Lower-cased and trimmed; compared case-insensitively at sign-in. */
  readonly email: string;
  readonly password: string;
}

/**
 * Administrator authentication (docs/admin-auth.md): one or two accounts
 * whose email + password come from environment variables, and server-side
 * sessions in admin_sessions.
 */
export interface AdminAuthConfig {
  /** NODE_ENV === 'production'. */
  readonly production: boolean;
  /** ADMIN_1_* and the optional ADMIN_2_*; empty outside production when unset (nobody can sign in). */
  readonly accounts: readonly AdminAccount[];
  /** Where the admin web app is served. */
  readonly adminAppOrigin: string;
  /** Origins allowed to send state-changing admin requests (CSRF Origin check). */
  readonly allowedOrigins: readonly string[];
  /** Secure cookie attribute. Only false outside production with an http admin origin. */
  readonly cookieSecure: boolean;
}

/**
 * node-postgres Pool sizing. Undefined means "the caller's default": main.ts
 * (a long-running local server) and the Vercel Function (many small
 * instances sharing Neon's pooler, docs/deploy-vercel.md) want different ones.
 */
export interface DatabasePoolConfig {
  /** PG_POOL_MAX: most connections one API instance may hold. */
  readonly max: number | undefined;
  /** PG_IDLE_TIMEOUT_MS: how long an idle connection stays open. */
  readonly idleTimeoutMillis: number | undefined;
}

export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly databasePool: DatabasePoolConfig;
  /**
   * Origins allowed to call the public share endpoint cross-origin (CORS,
   * no credentials). PUBLIC_APP_ORIGIN in production; the local public dev
   * server otherwise.
   */
  readonly publicAppOrigins: readonly string[];
  /** Fastify `trustProxy`: false, true, or the number of trusted proxy hops (TRUST_PROXY). */
  readonly trustProxy: boolean | number;
  readonly auth: AdminAuthConfig;
}

/** Matches docker-compose.yml defaults; a plain local setup needs no .env. */
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_DATABASE_URL = 'postgres://territorios:territorios@127.0.0.1:5432/territorios';
/** apps/admin's Vite dev server (vite.config.ts), reachable under both loopback names. */
const DEV_ADMIN_ORIGIN = 'http://localhost:5173';
const DEV_ADMIN_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
/** apps/public's Vite dev server (vite.config.ts). */
const DEV_PUBLIC_ORIGINS = ['http://127.0.0.1:5174', 'http://localhost:5174'];
export const MIN_ADMIN_PASSWORD_LENGTH = 12;
const ADMIN_ACCOUNT_SLOTS = [1, 2] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Reads every environment variable the API actually consumes (see
 * .env.example) and fails fast on invalid input instead of silently
 * binding to a wrong port or starting with a weakened admin boundary.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const rawPort = env.PORT ?? String(DEFAULT_PORT);
  if (!/^\d+$/.test(rawPort)) {
    throw new Error(`PORT must be a plain integer, got: ${JSON.stringify(rawPort)}`);
  }
  const port = Number.parseInt(rawPort, 10);
  if (port < 1 || port > 65535) {
    throw new Error(`PORT must be between 1 and 65535, got: ${rawPort}`);
  }

  return {
    host: env.HOST ?? DEFAULT_HOST,
    port,
    databaseUrl: env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    databasePool: {
      max: readPositiveInteger(env, 'PG_POOL_MAX'),
      idleTimeoutMillis: readPositiveInteger(env, 'PG_IDLE_TIMEOUT_MS')
    },
    publicAppOrigins: readPublicAppOrigins(env),
    trustProxy: readTrustProxy(env.TRUST_PROXY),
    auth: readAdminAuthConfig(env)
  };
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function readPositiveInteger(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const value = nonBlank(env[name]);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${name} must be a positive integer, got: ${JSON.stringify(env[name])}`);
  }
  return Number(value);
}

function readPublicAppOrigins(env: NodeJS.ProcessEnv): string[] {
  const production = env.NODE_ENV === 'production';
  const raw = nonBlank(env.PUBLIC_APP_ORIGIN);
  if (raw === undefined) {
    if (production) {
      throw new Error('PUBLIC_APP_ORIGIN is required when NODE_ENV=production (docs/deploy-vercel.md)');
    }
    return [...DEV_PUBLIC_ORIGINS];
  }
  const origins = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => parseOrigin(entry, 'PUBLIC_APP_ORIGIN'));
  if (production && origins.some((origin) => !origin.startsWith('https://'))) {
    throw new Error('PUBLIC_APP_ORIGIN must use https when NODE_ENV=production');
  }
  return [...new Set(origins)];
}

function readTrustProxy(raw: string | undefined): boolean | number {
  const value = nonBlank(raw);
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value) && Number(value) >= 1) return Number(value);
  throw new Error(`TRUST_PROXY must be "true", "false", or a positive hop count, got: ${JSON.stringify(raw)}`);
}

function readAdminAuthConfig(env: NodeJS.ProcessEnv): AdminAuthConfig {
  const production = env.NODE_ENV === 'production';

  const accounts = ADMIN_ACCOUNT_SLOTS.flatMap((slot) => readAdminAccount(env, slot));
  // Slot 1 specifically: a lone ADMIN_2_* in production is a misconfiguration.
  if (production && nonBlank(env.ADMIN_1_EMAIL) === undefined) {
    throw new Error('ADMIN_1_EMAIL and ADMIN_1_PASSWORD are required when NODE_ENV=production (docs/admin-auth.md)');
  }
  const emails = accounts.map((account) => account.email);
  if (new Set(emails).size !== emails.length) {
    throw new Error('ADMIN_1_EMAIL and ADMIN_2_EMAIL must be different accounts');
  }

  const rawOrigin = nonBlank(env.ADMIN_APP_ORIGIN);
  if (production && rawOrigin === undefined) {
    throw new Error('ADMIN_APP_ORIGIN is required when NODE_ENV=production (docs/admin-auth.md)');
  }
  const adminAppOrigin = parseOrigin(rawOrigin ?? DEV_ADMIN_ORIGIN, 'ADMIN_APP_ORIGIN');
  if (production && !adminAppOrigin.startsWith('https://')) {
    throw new Error('ADMIN_APP_ORIGIN must use https when NODE_ENV=production');
  }

  return {
    production,
    accounts,
    adminAppOrigin,
    allowedOrigins: production ? [adminAppOrigin] : [...new Set([adminAppOrigin, ...DEV_ADMIN_ORIGINS])],
    cookieSecure: production || adminAppOrigin.startsWith('https://')
  };
}

function readAdminAccount(env: NodeJS.ProcessEnv, slot: number): AdminAccount[] {
  const emailName = `ADMIN_${slot}_EMAIL`;
  const passwordName = `ADMIN_${slot}_PASSWORD`;
  const email = nonBlank(env[emailName])?.toLowerCase();
  // The password is used verbatim (no trimming): only an empty value counts as unset.
  const password = env[passwordName] === '' ? undefined : env[passwordName];
  if (email === undefined && password === undefined) return [];
  if (email === undefined || password === undefined) {
    throw new Error(`${emailName} and ${passwordName} must be set together`);
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error(`${emailName} is not an email address: ${JSON.stringify(email)}`);
  }
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(`${passwordName} must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`);
  }
  return [{ email, password }];
}

function parseOrigin(raw: string, name: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an origin like https://app.example.org, got: ${JSON.stringify(raw)}`);
  }
  const normalized = raw.replace(/\/$/, '');
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== normalized) {
    throw new Error(`${name} must be a bare origin (scheme://host[:port]), got: ${JSON.stringify(raw)}`);
  }
  return url.origin;
}
