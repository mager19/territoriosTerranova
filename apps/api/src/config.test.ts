import { describe, expect, it } from 'vitest';

import { readConfig } from './config.js';

const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  ADMIN_1_EMAIL: ' Ana@Example.org ',
  ADMIN_1_PASSWORD: 'correct horse battery',
  ADMIN_2_EMAIL: 'beto@example.org',
  ADMIN_2_PASSWORD: 'staple-gun-42-orchid',
  ADMIN_APP_ORIGIN: 'https://admin.example.org'
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
        ADMIN_APP_ORIGIN: 'https://admin.example.org'
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
