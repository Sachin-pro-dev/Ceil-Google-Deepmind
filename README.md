# Ceil

**A live-replanning multi-agent runtime for the enterprise — built on Google's Interactions API (iAPI) and Managed Agents.**

> Antigravity gives you one Managed Agent inside an IDE. **Ceil gives you an engineering department.**

Type one objective — *"Build a Leave Management module with role-based approvals and an admin dashboard"* — and Ceil spawns an AI engineering organization that plans the work, files **real Jira tickets**, writes **real code** committed as **real GitHub pull requests**, verifies it, recovers from its own failures, folds in requirement changes dropped into **Slack mid-build**, and ships to `main` behind a human governance gate.

Built solo for the **Google DeepMind Bangalore Hackathon** — Problem Statement 2: *Autonomous Orchestration with Managed Agents (iAPI)*.

---

## What a run looks like

1. **Plan** — a Manager agent (Gemini 3.5 Flash) writes a delivery strategy; a Planning agent (Gemini 3.1 Pro, structured output) decomposes it into role-scoped tasks and files real Jira tickets (REST v3).
2. **Build in parallel** — Database, Backend, and Frontend agents generate actual code files (TypeScript/SQL) via schema-constrained Gemini calls, commit them to real feature branches, and open real GitHub PRs.
3. **Verify** — a QA agent inspects CI check runs on every PR.
4. **Self-heal** — on a failure, the Supervisor agent reads it from Shared Memory, produces an LLM diagnosis, emits `ConflictDetected` / `RecoveryInitiated`, spawns a fix task for the responsible builder, and re-queues QA. No human input.
5. **Replan live** — type a requirement change into the real Slack channel mid-build; the Looper picks it up on its next tick, new tasks and tickets appear, and the org rewires **without restarting**.
6. **Ship under governance** — at Autonomy Level 4, Ceil auto-merges all feature branches into `staging`; production blocks on human approval (Console button + Slack message). On approval it merges `staging → main` and publishes release notes.

Every artifact is real and clickable: tickets on the Jira board, merged PRs and final code on `main`, bot messages in Slack.

## The track's four questions, answered architecturally

**1. How do agents hand off without losing context?**
Agents never exchange messages — there are no agent-to-agent DMs anywhere in the system. All state lives in a canonical **Shared Memory** (six-table relational schema: `objectives`, `tasks`, `artifacts`, `events`, `agent_sessions`, `decisions`). The **Looper** synthesizes a fresh, minimal, purpose-built prompt for each agent from current memory on every dispatch. Context cannot bleed, bloat, or get lost — chat history is never the transport; the database is.

**2. How do agents safely use tools and APIs?**
Tool access is **role-scoped at spawn time**: the adapter set injected into each agent is fixed by its role — the Backend agent has no Jira handle to misuse; the constraint is structural, not a system-prompt promise. Credentials never enter agent context (env config only, redacted from all logs), mirroring iAPI's egress-proxy header-transform model. Every tool call and artifact write is published as a typed event into an append-only audit log.

**3. How do agents split labor and resolve conflicts?**
Role-typed agents with disjoint responsibilities (Planning decomposes but never codes; QA verifies but never merges) and a three-tier conflict model: the Looper auto-cancels stale work → the Supervisor diagnoses failures and re-tasks builders → humans are escalated to only at the governance gate. All of it is visible live in the Console.

**4. How does it tackle objectives a single agent would fail?**
Parallel role execution (backend + frontend build concurrently in separate lanes), bounded per-agent context, a distinct verifier tier, and continuous replanning — the plan is re-derived from world state every 3 seconds, not fixed at t=0.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Ceil Console (dark-mode mission control, :8080)        │
│  org chart · activity stream · Looper panel ·           │
│  code drawer · artifacts feed · approval gate           │
└──────────────────────┬──────────────────────────────────┘
                       │ polls JSON state API
┌──────────────────────┴──────────────────────────────────┐
│  Orchestration Runtime (Node 22 + TypeScript + Fastify) │
│                                                         │
│   LOOPER (3s heartbeat)                                 │
│   read state snapshot → decide next action →            │
│   narrate via Gemini → record decision → route          │
│                                                         │
│   Shared Memory (Postgres/PGlite via Drizzle)           │
│   Event Bus (16 typed events, zod-validated)            │
│   Role agents: Manager · Planning · Backend ·           │
│   Frontend · Database · QA · Supervisor                 │
└───────┬───────────────┬──────────────┬─────────────────┘
        │               │              │
   GitHub REST     Jira REST v3    Slack Web API
   (branches,      (real tickets)  (posts + inbound
   commits, PRs,                    polling → replan)
   merges, checks)
```

- **The Looper** — a deterministic-core replanner: each tick reads a bounded state snapshot (tasks, artifacts, events, unread Slack), derives the next action through a 12-state pipeline (`spawn_manager → spawn_planning → create_tickets → replan / recover → run_database → run_builders → run_qa → deploy_staging → await_approval → deploy_prod → complete`), narrates its reasoning via Gemini, and records every decision for a fully replayable trace. Deterministic selection + LLM narration = predictable *and* explainable.
- **LLM layer** — direct Gemini calls (`x-goog-api-key`), JSON mode + zod validation with automatic retry on malformed output. Model routing per role: Flash for latency-critical ticks and builders, Pro for planning. An **iAPI Managed-Agent adapter** implements the two-step `POST /v1beta/agents` → `POST /v1beta/interactions` shape with persistent `environment_id` reuse (`AGENT_MODE=iapi`).
- **Dual-implementation integrations** — every external tool sits behind an interface with two complete implementations: live REST adapters (GitHub Contents/Pulls/Merges/Checks · Slack `chat.postMessage` + `conversations.history` · Jira REST v3 with project auto-discovery) and offline mocks with identical contracts. One env flag (`TOOLS_MODE=mock|real`) flips the entire system — the demo kill-switch.
- **Autonomy Slider** — six levels from dry-run to full-auto. The demo runs Level 4: staging merges autonomously, production requires a human.

## How to run

Requires Node.js ≥ 20. No Docker, no cloud account, no API keys needed for mock mode.

```bash
git clone https://github.com/Sachin-pro-dev/Ceil-Google-Deepmind.git
cd Ceil-Google-Deepmind
npm ci

# THE DEMO: start the Console and open http://localhost:8080
npm run dev
```

Type an objective, tick "stage a QA failure", click **Spawn the org** — then click any builder node to watch the code it wrote, send a requirement change from the Slack box, and approve the production gate when it appears.

### Modes

Everything defaults to **mock mode**: fully functional offline stand-ins, zero external side effects, zero quota. To go live, copy `.env.local.example` → `.env.local` and set:

| Flag | Values | Effect |
|---|---|---|
| `LLM_MODE` | `mock` / `real` | canned reasoning ↔ live Gemini (needs `GEMINI_API_KEY`) |
| `TOOLS_MODE` | `mock` / `real` | offline SDLC ↔ real GitHub + Jira + Slack (needs tokens) |
| `AGENT_MODE` | `gemini` / `iapi` | direct Gemini work engine ↔ real Managed-Agent sandboxes |

Secrets live only in `.env.local` (gitignored). Logs redact all keys.

### Terminal demos & tests

```bash
npm run demo:phase1   # runtime spine: events -> memory -> mirror
npm run demo:phase2   # prompt -> strategy -> tasks -> Jira tickets
npm run demo:phase3   # full pipeline: tickets -> PRs -> QA -> deploy gate
npm run demo:phase4   # QA failure -> Supervisor recovery + Slack replan + gate
npm test              # 13 integration tests, fully offline (in-memory Postgres)
```

## Stack

TypeScript · Node.js 22 · Fastify · **Gemini 3.5 Flash + Gemini 3.1 Pro** (Interactions API) · Managed Agents (`antigravity-preview-05-2026`) · PGlite/Postgres + Drizzle ORM · zod · pino · GitHub / Jira Cloud / Slack REST APIs · vitest

## Layout

```
src/
  config.ts             centralized zod-validated config (no hardcoded values)
  logger.ts             pino, secret-redacting
  db/                   schema (6 tables), PGlite client, migrations
  memory/               SharedMemory repository · hot cache · realtime mirror
  bus/                  typed event taxonomy · in-process bus · dual-write persistence
  llm/gemini.ts         Gemini client: JSON mode + zod validation + retry
  agents/
    agent-runner.ts     AgentRunner interface (iAPI two-step shape)
    iapi-agent-runner.ts  real Managed-Agent sandboxes (/v1beta/agents + /interactions)
    gemini-agent-runner.ts offline-capable work engine
    roles/              manager · planning · builder · qa · supervisor
  looper/looper.ts      the live replanner (12-action pipeline)
  integrations/         jira · github · slack · confluence — mock + real adapters
  console/index.html    mission-control UI
  server.ts             Fastify: Console + state API + approval gate
scripts/                per-phase demos · migration · live smoke tests
test/                   13 offline integration tests
```

## Design lineage

Ceil is Andrej Karpathy's generator-verifier loop + autonomy-slider pattern (YC AI Startup School, 2025) applied at organization scale: context engineering per agent, orchestrated LLM calls over a live DAG, a human-in-the-loop GUI, and a per-environment autonomy slider — scaled from one assistant to a department.

## Author

**Sachin Baluragi** — solo build, with Claude Code as build accelerant.
