import { describe, expect, it } from 'vitest';

import { readConfig } from './config.js';

const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  ADMIN_1_EMAIL: ' Ana@Example.org ',
  ADMIN_1_PASSWORD: 'correct horse battery',
  ADMIN_2_EMAIL: 'beto@example.org',
  ADMIN_2_PASSWORD: 'staple-gun-42-orchid',
  ADMIN_APP_ORIGIN: 'https://admin.example.org',
  PUBLIC_APP_ORIGIN: 'https://public.example.org'
} as const;

describe('readConfig', () => {
  it('falls back to the documented docker-compose defaults', () => {
    expect(readConfig({})).toMatchObject({
      host: '127.0.0.1',
      port: 3000,
      databaseUrl: 'postgres://territorios:territorios@127.0.0.1:5432/territorios',
      trustProxy: false
    });
  });

  it('reads PORT, HOST, and DATABASE_URL from the environment', () => {
    const config = readConfig({
      PORT: '8080',
      HOST: '0.0.0.0',
      DATABASE_URL: 'postgres://user:pw@db-host:5433/app'
    });

    expect(config.port).toBe(8080);
    expect(config.host).toBe('0.0.0.0');
    expect(config.databaseUrl).toBe('postgres://user:pw@db-host:5433/app');
  });

  it('rejects a PORT that is not a plain integer', () => {
    expect(() => readConfig({ PORT: 'not-a-port' })).toThrow(/PORT/);
    expect(() => readConfig({ PORT: '3000abc' })).toThrow(/PORT/);
    expect(() => readConfig({ PORT: '' })).toThrow(/PORT/);
    expect(() => readConfig({ PORT: '-1' })).toThrow(/PORT/);
  });

  it('rejects a PORT outside the valid range', () => {
    expect(() => readConfig({ PORT: '0' })).toThrow(/PORT/);
    expect(() => readConfig({ PORT: '70000' })).toThrow(/PORT/);
  });

  it('reads TRUST_PROXY as a boolean or a hop count', () => {
    expect(readConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(readConfig({ TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(readConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(() => readConfig({ TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
  });

  it('leaves the pg pool size and idle timeout to the caller unless configured', () => {
    expect(readConfig({}).databasePool).toEqual({ max: undefined, idleTimeoutMillis: undefined });
    expect(readConfig({ PG_POOL_MAX: '2', PG_IDLE_TIMEOUT_MS: '5000' }).databasePool).toEqual({
      max: 2,
      idleTimeoutMillis: 5000
    });
  });

  it('rejects a pg pool size or idle timeout that is not a positive integer', () => {
    expect(() => readConfig({ PG_POOL_MAX: '0' })).toThrow(/PG_POOL_MAX/);
    expect(() => readConfig({ PG_POOL_MAX: 'three' })).toThrow(/PG_POOL_MAX/);
    expect(() => readConfig({ PG_IDLE_TIMEOUT_MS: '-5' })).toThrow(/PG_IDLE_TIMEOUT_MS/);
  });
});

describe('readConfig — public app origins (CORS)', () => {
  it('allows the local public dev server under both loopback names by default', () => {
    expect(readConfig({}).publicAppOrigins).toEqual(['http://127.0.0.1:5174', 'http://localhost:5174']);
  });

  it('reads PUBLIC_APP_ORIGIN as the only allowed origin in production', () => {
    const config = readConfig({ ...PRODUCTION_ENV, PUBLIC_APP_ORIGIN: 'https://public.example.org/' });
    expect(config.publicAppOrigins).toEqual(['https://public.example.org']);
  });

  it('accepts a comma-separated list of public origins', () => {
    const config = readConfig({
      ...PRODUCTION_ENV,
      PUBLIC_APP_ORIGIN: 'https://public.example.org, https://www.public.example.org'
    });
    expect(config.publicAppOrigins).toEqual(['https://public.example.org', 'https://www.public.example.org']);
  });

  it('refuses to start in production without an https PUBLIC_APP_ORIGIN', () => {
    const env: Record<string, string> = { ...PRODUCTION_ENV };
    delete env.PUBLIC_APP_ORIGIN;
    expect(() => readConfig(env)).toThrow(/PUBLIC_APP_ORIGIN/);
    expect(() => readConfig({ ...PRODUCTION_ENV, PUBLIC_APP_ORIGIN: 'http://public.example.org' })).toThrow(
      /PUBLIC_APP_ORIGIN/
    );
  });

  it('rejects a public origin that is not a bare origin', () => {
    expect(() => readConfig({ PUBLIC_APP_ORIGIN: 'https://public.example.org/share' })).toThrow(/PUBLIC_APP_ORIGIN/);
    expect(() => readConfig({ PUBLIC_APP_ORIGIN: '*' })).toThrow(/PUBLIC_APP_ORIGIN/);
  });
});

describe('readConfig — admin auth', () => {
  it('has a local-development default: localhost admin origin over http, no accounts', () => {
    const { auth } = readConfig({});

    expect(auth).toEqual({
      production: false,
      accounts: [],
      adminAppOrigin: 'http://localhost:5173',
      allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      cookieSecure: false
    });
  });

  it('reads both production accounts, lower-casing and trimming the emails but never the passwords', () => {
    const { auth } = readConfig({ ...PRODUCTION_ENV, ADMIN_1_PASSWORD: '  spaces count too  ' });

    expect(auth).toEqual({
      production: true,
      accounts: [
        { email: 'ana@example.org', password: '  spaces count too  ' },
        { email: 'beto@example.org', password: 'staple-gun-42-orchid' }
      ],
      adminAppOrigin: 'https://admin.example.org',
      allowedOrigins: ['https://admin.example.org'],
      cookieSecure: true
    });
  });

  it('accepts a single production account (admin 2 is optional)', () => {
    const env: Record<string, string> = { ...PRODUCTION_ENV };
    delete env.ADMIN_2_EMAIL;
    delete env.ADMIN_2_PASSWORD;
    expect(readConfig(env).auth.accounts).toEqual([{ email: 'ana@example.org', password: 'correct horse battery' }]);
  });

  it.each(['ADMIN_1_EMAIL', 'ADMIN_1_PASSWORD', 'ADMIN_APP_ORIGIN'] as const)('refuses to start in production without %s', (name) => {
    const env: Record<string, string> = { ...PRODUCTION_ENV };
    delete env[name];
    expect(() => readConfig(env)).toThrow(new RegExp(name));
  });

  it('refuses to start in production with only ADMIN_2_* configured', () => {
    expect(() =>
      readConfig({
        NODE_ENV: 'production',
        ADMIN_2_EMAIL: 'beto@example.org',
        ADMIN_2_PASSWORD: 'staple-gun-42-orchid',
        ADMIN_APP_ORIGIN: 'https://admin.example.org',
        PUBLIC_APP_ORIGIN: 'https://public.example.org'
      })
    ).toThrow(/ADMIN_1_EMAIL/);
  });

  it('rejects a password shorter than 12 characters', () => {
    expect(() => readConfig({ ...PRODUCTION_ENV, ADMIN_2_PASSWORD: 'elevenchars' })).toThrow(/ADMIN_2_PASSWORD.*12/);
    expect(() => readConfig({ ADMIN_1_EMAIL: 'ana@example.org', ADMIN_1_PASSWORD: 'short' })).toThrow(/ADMIN_1_PASSWORD/);
  });

  it('rejects the same email for both accounts, case-insensitively', () => {
    expect(() => readConfig({ ...PRODUCTION_ENV, ADMIN_2_EMAIL: 'ANA@example.org' })).toThrow(/different/);
  });

  it('rejects an email without its password and vice versa', () => {
    expect(() => readConfig({ ADMIN_1_EMAIL: 'ana@example.org' })).toThrow(/ADMIN_1_PASSWORD/);
    expect(() => readConfig({ ADMIN_2_PASSWORD: 'staple-gun-42-orchid' })).toThrow(/ADMIN_2_EMAIL/);
  });

  it('rejects an account email that is not an email address', () => {
    expect(() => readConfig({ ADMIN_1_EMAIL: 'not-an-email', ADMIN_1_PASSWORD: 'correct horse battery' })).toThrow(
      /ADMIN_1_EMAIL/
    );
  });

  it('rejects a non-https admin origin in production', () => {
    expect(() => readConfig({ ...PRODUCTION_ENV, ADMIN_APP_ORIGIN: 'http://admin.example.org' })).toThrow(/ADMIN_APP_ORIGIN/);
  });

  it('rejects an admin origin that is not a bare origin', () => {
    expect(() => readConfig({ ADMIN_APP_ORIGIN: 'https://admin.example.org/app' })).toThrow(/ADMIN_APP_ORIGIN/);
    expect(() => readConfig({ ADMIN_APP_ORIGIN: 'not a url' })).toThrow(/ADMIN_APP_ORIGIN/);
  });
});
