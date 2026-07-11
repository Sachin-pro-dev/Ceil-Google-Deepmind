# Ceil

A live-replanning multi-agent orchestration runtime for the enterprise, built on Google's
Interactions API (iAPI) and Managed Agents. Ceil takes one open-ended objective and delivers
it end-to-end through a team of role-scoped agents that hand off via **Shared Memory** (never
agent-to-agent DMs), coordinated by a heartbeat **Looper** that re-plans continuously.

> Hackathon: Google DeepMind Bangalore — Problem Statement 2 (Autonomous Orchestration).

## Status — Phases 1–5 ✅ (of 6)

- **Phase 1 — Foundation:** config, logging, Shared Memory schema (6 tables) on **PGlite**,
  typed event bus with dual-write persistence, `AgentRunner` interface + mock.
- **Phase 2 — Core Trio:** `GeminiClient` (mock/real via `LLM_MODE`), **Manager** +
  **Planning** agents, **Looper** heartbeat. Prompt in → strategy → tasks → Jira tickets.
- **Phase 3 — Builders + GitHub:** **Database/Backend/Frontend builder agents** (backend+frontend
  run in parallel) + **QA agent** (GitHub Actions checks). Work engine selectable via
  `AGENT_MODE`: `gemini` (direct calls, offline-capable) or `iapi` (real Managed-Agent
  sandboxes via `/v1beta/agents` + `/v1beta/interactions`). Full pipeline:
  prompt → tickets → PRs → QA checks → **delivered**.

- **Phase 4 — Live replanning + Supervisor + governance:** Slack inbound polled every Looper
  tick — a mid-flight requirement change **replans the org without restart**. The
  **Supervisor** detects failed QA by reading Shared Memory, diagnoses, emits
  `ConflictDetected`/`RecoveryInitiated`, re-tasks the builder, and QA re-verifies. Staging
  deploys autonomously (Autonomy Level 4); **production blocks on human approval**.
- **Phase 5 — Console + Confluence:** dark-mode mission-control Console (org chart with live
  status glows, event stream, Looper tick panel, artifacts feed, Slack injector, prod-approval
  gate button) served at `http://localhost:8080`, polling the state API. Release notes are
  published to Confluence + a Slack summary on prod deploy.

Remaining: Phase 6 (demo prep). All external tools (Jira/GitHub/Slack/Confluence) run as
mock adapters — fully functional, zero external side effects; real MCP wiring is the
post-hackathon path. Note: the Console is a static page served by Fastify (deviation from
the PRD's Next.js + React Flow stack, chosen for the hackathon window).

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

# 4. THE DEMO: start the Console and open http://localhost:8080
npm run dev
#    - type an objective, tick "stage a QA failure", click "Spawn the org"
#    - watch the org chart work; drop a Slack change mid-run; approve the prod gate

# 5. Terminal demos — each drives its phase end-to-end and prints the result
npm run demo:phase1   # runtime spine
npm run demo:phase2   # Core Trio: prompt -> strategy -> tasks -> tickets
npm run demo:phase3   # full pipeline: prompt -> tickets -> PRs -> QA -> delivered
npm run demo:phase4   # recovery + live replanning + governance gate

# 6. Run the tests (in-memory, touches nothing external)
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
