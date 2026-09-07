import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { queryPostgisVersion } from './health.js';

function fakePool(rows: unknown[]): Pick<Pool, 'query'> {
  return { query: async () => ({ rows }) } as unknown as Pick<Pool, 'query'>;
}

describe('queryPostgisVersion', () => {
  it('returns the version string reported by the database', async () => {
    await expect(queryPostgisVersion(fakePool([{ version: '3.4.3' }]))).resolves.toBe('3.4.3');
  });

  it('throws when the query yields no row', async () => {
    await expect(queryPostgisVersion(fakePool([]))).rejects.toThrow(/postgis_version/);
  });

  it('throws when the version is not a usable string', async () => {
    await expect(queryPostgisVersion(fakePool([{ version: 42 }]))).rejects.toThrow(
      /postgis_version/
    );
    await expect(queryPostgisVersion(fakePool([{ version: '' }]))).rejects.toThrow(
      /postgis_version/
    );
  });
});
