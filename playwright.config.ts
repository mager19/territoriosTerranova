import { defineConfig } from '@playwright/test';

/**
 * Playwright is wired at the root per the bootstrap brief. The E2E suite
 * itself lives in tests/e2e/** and is owned by the verifier agent (A7).
 * No root test:e2e script is registered yet: per AGENTS.md, a surface
 * with no tests has no test script. A7 registers it alongside the first
 * real E2E test.
 */
export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:5173'
  }
});
