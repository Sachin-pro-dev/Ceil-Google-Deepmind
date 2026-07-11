import { defineConfig } from 'vitest/config';

// Tests run against an in-memory PGlite so they never touch disk or the cloud (Principle 7).
export default defineConfig({
  test: {
    // Force offline modes so tests never hit real services regardless of .env.local.
    env: {
      CEIL_ENV: 'local',
      PGLITE_PATH: 'memory',
      LOG_LEVEL: 'warn',
      LLM_MODE: 'mock',
      TOOLS_MODE: 'mock',
      AGENT_MODE: 'gemini',
    },
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
