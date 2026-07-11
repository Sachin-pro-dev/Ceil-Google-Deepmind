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
  // Per-role model overrides (fast Flash for chatty ticks, Pro for planning).
  MODEL_MANAGER: z.string().default('gemini-3.5-flash'),
  MODEL_PLANNING: z.string().default('gemini-3.1-pro-preview'),
  MODEL_LOOPER: z.string().default('gemini-3.5-flash'),
  // "mock" = canned deterministic LLM output (no key, no quota); "real" = live Gemini.
  LLM_MODE: z.enum(['mock', 'real']).default('mock'),
  // Builder work engine: "gemini" = direct Gemini calls (offline-capable);
  // "iapi" = real Managed-Agent sandboxes via the Interactions API.
  AGENT_MODE: z.enum(['gemini', 'iapi']).default('gemini'),
  IAPI_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  // Target repo the builders "work" on (mock GitHub adapter mints URLs under this).
  GITHUB_REPO_URL: z.string().default('https://github.com/ceil/demo'),
  // External SDLC tools: "mock" (offline stand-ins) or "real" (live GitHub/Slack/Jira).
  TOOLS_MODE: z.enum(['mock', 'real']).default('mock'),
  GITHUB_TOKEN: z.string().default(''),
  GITHUB_API_URL: z.string().default('https://api.github.com'),
  SLACK_BOT_TOKEN: z.string().default(''),
  SLACK_CHANNEL_ID: z.string().default(''),
  SLACK_API_URL: z.string().default('https://slack.com/api'),
  JIRA_BASE_URL: z.string().default(''),
  JIRA_EMAIL: z.string().default(''),
  JIRA_API_TOKEN: z.string().default(''),
  JIRA_PROJECT_KEY: z.string().default(''),
  // Demo lever: make the FIRST QA check run fail so the Supervisor recovery is visible.
  INJECT_QA_FAILURE: z.enum(['true', 'false']).default('false'),
  STAGING_URL: z.string().default('https://staging.ceil-demo.app'),
  STAGING_BRANCH: z.string().default('staging'),
  PROD_URL: z.string().default('https://ceil-demo.app'),
  LOOPER_TICK_MS: z.coerce.number().int().positive().default(3000),
  LOOPER_MAX_TICKS: z.coerce.number().int().positive().default(30),
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
  llmMode: parsed.LLM_MODE,
  agentMode: parsed.AGENT_MODE,
  iapiTimeoutMs: parsed.IAPI_TIMEOUT_MS,
  githubRepoUrl: parsed.GITHUB_REPO_URL,
  injectQaFailure: parsed.INJECT_QA_FAILURE === 'true',
  stagingUrl: parsed.STAGING_URL,
  stagingBranch: parsed.STAGING_BRANCH,
  prodUrl: parsed.PROD_URL,
  toolsMode: parsed.TOOLS_MODE,
  github: {
    token: parsed.GITHUB_TOKEN,
    apiUrl: parsed.GITHUB_API_URL,
    // "owner/name" parsed from the repo URL's path.
    repo: new URL(parsed.GITHUB_REPO_URL).pathname.replace(/^\/+|\.git$|\/+$/g, ''),
  },
  slack: {
    botToken: parsed.SLACK_BOT_TOKEN,
    channelId: parsed.SLACK_CHANNEL_ID,
    apiUrl: parsed.SLACK_API_URL,
  },
  jira: {
    baseUrl: parsed.JIRA_BASE_URL.replace(/\/+$/, ''),
    email: parsed.JIRA_EMAIL,
    apiToken: parsed.JIRA_API_TOKEN,
    projectKey: parsed.JIRA_PROJECT_KEY,
  },
  models: {
    flash: parsed.MODEL_FLASH,
    pro: parsed.MODEL_PRO,
    manager: parsed.MODEL_MANAGER,
    planning: parsed.MODEL_PLANNING,
    looper: parsed.MODEL_LOOPER,
  },
  looperTickMs: parsed.LOOPER_TICK_MS,
  looperMaxTicks: parsed.LOOPER_MAX_TICKS,
  gcpProjectId: parsed.GCP_PROJECT_ID,
} as const;

export type Config = typeof config;
