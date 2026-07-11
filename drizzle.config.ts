import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations from src/db/schema.ts into ./drizzle (offline, no DB needed).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
