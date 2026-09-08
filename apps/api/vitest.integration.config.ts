import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/integration/**/*.test.ts'],
    // Testcontainers cleanup relies on process signals; forks are the
    // recommended pool. One file, one container: no file parallelism.
    pool: 'forks',
    fileParallelism: false,
    // PostGIS runs under amd64 emulation on arm64 macs: generous timeouts.
    testTimeout: 120_000,
    hookTimeout: 360_000
  }
});
