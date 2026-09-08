import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests need Docker (Testcontainers) and run separately via
    // `pnpm --filter @territorios/geo test:integration`, keeping the default
    // unit suite hermetic.
    exclude: ['src/integration/**', 'node_modules/**', 'dist/**']
  }
});
