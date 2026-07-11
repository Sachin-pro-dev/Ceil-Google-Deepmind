import { defineConfig } from 'vitest/config';

// Tests run against an in-memory PGlite so they never touch disk or the cloud (Principle 7).
export default defineConfig({
  test: {
    env: { CEIL_ENV: 'local', PGLITE_PATH: 'memory', LOG_LEVEL: 'warn' },
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
