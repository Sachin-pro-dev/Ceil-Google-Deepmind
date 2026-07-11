/**
 * Centralized configuration (Principle 4: no hardcoded config anywhere else).
 * Every URL, port, model id, path, and secret is read and validated here.
 * Loads .env.local first (gitignored secrets), then .env as a fallback.
 */
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: '.env.local' });
dotenv.config();

const envSchema = z.object({
  CEIL_ENV: z.enum(['local', 'cloud']).default('local'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().int().positive().default(8080),
  PGLITE_PATH: z.string().default('./.data/pglite'),
  GEMINI_API_KEY: z.string().default(''),
  IAPI_BASE_URL: z.string().default('https://generativelanguage.googleapis.com/v1beta'),
  AGENT_BASE: z.string().default('antigravity-preview-05-2026'),
  MODEL_FLASH: z.string().default('gemini-3.5-flash'),
  MODEL_PRO: z.string().default('gemini-3.1-pro-preview'),
  LOOPER_TICK_MS: z.coerce.number().int().positive().default(3000),
  GCP_PROJECT_ID: z.string().default(''),
});

const parsed = envSchema.parse(process.env);

/** Immutable, typed configuration for the whole runtime. */
export const config = {
  env: parsed.CEIL_ENV,
  logLevel: parsed.LOG_LEVEL,
  port: parsed.PORT,
  pglitePath: parsed.PGLITE_PATH,
  geminiApiKey: parsed.GEMINI_API_KEY,
  iapiBaseUrl: parsed.IAPI_BASE_URL,
  agentBase: parsed.AGENT_BASE,
  models: { flash: parsed.MODEL_FLASH, pro: parsed.MODEL_PRO },
  looperTickMs: parsed.LOOPER_TICK_MS,
  gcpProjectId: parsed.GCP_PROJECT_ID,
} as const;

export type Config = typeof config;
