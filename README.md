# Ceil

A live-replanning multi-agent orchestration runtime for the enterprise, built on Google's
Interactions API (iAPI) and Managed Agents. Ceil takes one open-ended objective and delivers
it end-to-end through a team of role-scoped agents that hand off via **Shared Memory** (never
agent-to-agent DMs), coordinated by a heartbeat **Looper** that re-plans continuously.

> Hackathon: Google DeepMind Bangalore — Problem Statement 2 (Autonomous Orchestration).

## Status — Phase 1: Foundation ✅

The runtime spine is in place and runs fully offline (no cloud, no Docker):

- Centralized, validated config (`src/config.ts`) and pino logging with secret redaction.
- Shared Memory schema (6 tables, indexed) on **PGlite** (embedded Postgres) via Drizzle ORM.
- In-process **event bus** with a typed event taxonomy and dual-write persistence
  (durable Postgres log + real-time mirror for the Console).
- **AgentRunner** interface shaped to the real iAPI two-step model, plus a **MockAgentRunner**
  ("dummy agent that logs events") to exercise the whole spine with zero quota.

Later phases add the real iAPI adapter, the Looper, builder agents, MCP tool integrations,
the Console, and the cloud (Cloud SQL / Firestore / Redis / Pub/Sub) adapters.

## Architecture (local adapters ↔ cloud adapters)

| Concern            | Local (default)                    | Cloud (deploy phase)   |
| ------------------ | ---------------------------------- | ---------------------- |
| Durable memory     | PGlite (embedded) via Drizzle      | Cloud SQL Postgres     |
| Hot cache          | in-memory `HotCache`               | Memorystore Redis      |
| Real-time mirror   | in-memory `RealtimeMirror`         | Firestore              |
| Event bus          | in-process `EventBus`              | Cloud Pub/Sub          |
| Agent runtime      | `MockAgentRunner`                  | iAPI via `@google/genai` |

Everything is swapped by the `CEIL_ENV` config flag. Local implementations are real and
fully functional, not stubs.

## How to run

Requires Node.js >= 20.

```bash
# 1. Install dependencies
npm install

# 2. Configure (copy the template; defaults are fine for local Phase 1)
cp .env.local.example .env.local        # never commit .env.local

# 3. Generate SQL migrations from the schema
npm run db:generate

# 4. Run the Phase 1 demo — drives the spine end-to-end and prints the result
npm run demo:phase1

# 5. Run the integration test (in-memory, touches nothing external)
npm test

# Optional: start the HTTP skeleton (GET /health, POST /objectives)
npm run dev
```

## Configuration

All configurable values live in `.env.local` and are read only through `src/config.ts`.
Models are pinned to `gemini-3.5-flash` (role agents) and `gemini-3.1-pro-preview`
(Looper/Planning); base agent `antigravity-preview-05-2026`. **Secrets go only in
`.env.local`, which is gitignored — never commit them.**

## Layout

```
src/
  config.ts            centralized config
  logger.ts            pino logger (secret-redacting)
  db/                  schema.ts, client.ts (PGlite), migrate.ts
  memory/              shared-memory.ts, hot-cache.ts, realtime-mirror.ts
  bus/                 events.ts, event-bus.ts, persist.ts
  agents/              agent-runner.ts (interface), mock-agent-runner.ts
  index.ts             composition root (bootstrap)
  server.ts            minimal Fastify HTTP surface
scripts/               migrate.ts, phase1-demo.ts
test/                  spine.test.ts
```
