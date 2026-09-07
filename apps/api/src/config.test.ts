import { describe, expect, it } from 'vitest';

import { readConfig } from './config.js';

describe('readConfig', () => {
  it('falls back to the documented docker-compose defaults', () => {
    expect(readConfig({})).toEqual({
      host: '127.0.0.1',
      port: 3000,
      databaseUrl: 'postgres://territorios:territorios@127.0.0.1:5432/territorios'
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
});
