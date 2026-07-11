/**
 * Assembles the Ceil runtime spine from local adapters and wires them together:
 * DB + Shared Memory + hot cache + real-time mirror + event bus (with persistence)
 * + the Gemini client + role agents (Manager, Planning) + Jira + the Looper.
 * This is the single composition root.
 */
import { getDb } from './db/client';
import { runMigrations } from './db/migrate';
import { SharedMemory } from './memory/shared-memory';
import { InMemoryHotCache } from './memory/hot-cache';
import { InMemoryRealtimeMirror } from './memory/realtime-mirror';
import { InProcessEventBus } from './bus/event-bus';
import { attachPersistence } from './bus/persist';
import { MockAgentRunner } from './agents/mock-agent-runner';
import { GeminiAgentRunner } from './agents/gemini-agent-runner';
import { IapiAgentRunner } from './agents/iapi-agent-runner';
import type { AgentRunner } from './agents/agent-runner';
import { GeminiClient } from './llm/gemini';
import { MockJiraAdapter } from './integrations/jira';
import { MockGitHubAdapter } from './integrations/github';
import { MockSlackAdapter } from './integrations/slack';
import { MockConfluenceAdapter } from './integrations/confluence';
import { ManagerAgent } from './agents/roles/manager';
import { PlanningAgent } from './agents/roles/planning';
import { BuilderAgent } from './agents/roles/builder';
import { QAAgent } from './agents/roles/qa';
import { SupervisorAgent } from './agents/roles/supervisor';
import { Looper } from './looper/looper';
import { childLogger } from './logger';
import { config } from './config';

const log = childLogger('bootstrap');

export interface Runtime {
  memory: SharedMemory;
  cache: InMemoryHotCache;
  mirror: InMemoryRealtimeMirror;
  bus: InProcessEventBus;
  runner: MockAgentRunner;
  workRunner: AgentRunner;
  gemini: GeminiClient;
  jira: MockJiraAdapter;
  github: MockGitHubAdapter;
  slack: MockSlackAdapter;
  confluence: MockConfluenceAdapter;
  manager: ManagerAgent;
  planning: PlanningAgent;
  builder: BuilderAgent;
  qa: QAAgent;
  supervisor: SupervisorAgent;
  looper: Looper;
}

/** Initialize and wire the runtime. `stepDelayMs` paces the mock agent for demos. */
export async function bootstrap(opts: { stepDelayMs?: number } = {}): Promise<Runtime> {
  log.info({ env: config.env, llmMode: config.llmMode }, 'bootstrapping Ceil runtime');
  const { db } = await getDb();
  await runMigrations();

  const memory = new SharedMemory(db);
  const cache = new InMemoryHotCache();
  const mirror = new InMemoryRealtimeMirror();
  const bus = new InProcessEventBus();
  attachPersistence(bus, memory, mirror);
  const runner = new MockAgentRunner({ bus, memory, stepDelayMs: opts.stepDelayMs });

  const gemini = new GeminiClient({ mode: config.llmMode, apiKey: config.geminiApiKey, baseUrl: config.iapiBaseUrl });
  const jira = new MockJiraAdapter();
  const github = new MockGitHubAdapter();
  const slack = new MockSlackAdapter();
  const confluence = new MockConfluenceAdapter();
  const manager = new ManagerAgent({ gemini, memory, bus });
  const planning = new PlanningAgent({ gemini, memory, bus });

  // Builder work engine: direct Gemini (offline-capable) or real iAPI Managed Agents.
  const workRunner: AgentRunner =
    config.agentMode === 'iapi' ? new IapiAgentRunner() : new GeminiAgentRunner({ gemini });
  const builder = new BuilderAgent({ runner: workRunner, github, memory, bus });
  const qa = new QAAgent({ github, memory, bus });
  const supervisor = new SupervisorAgent({ gemini, memory, bus });
  const looper = new Looper({ memory, bus, gemini, jira, slack, confluence, manager, planning, builder, qa, supervisor });

  log.info({ agentMode: config.agentMode }, 'runtime ready');
  return { memory, cache, mirror, bus, runner, workRunner, gemini, jira, github, slack, confluence, manager, planning, builder, qa, supervisor, looper };
}
