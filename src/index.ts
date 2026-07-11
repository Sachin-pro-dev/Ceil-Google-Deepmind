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
import { MockJiraAdapter, type JiraAdapter } from './integrations/jira';
import { MockGitHubAdapter, type GitHubAdapter } from './integrations/github';
import { MockSlackAdapter, type SlackAdapter, type SlackMessage } from './integrations/slack';
import { MockConfluenceAdapter } from './integrations/confluence';
import { RealGitHubAdapter } from './integrations/real-github';
import { RealSlackAdapter } from './integrations/real-slack';
import { RealJiraAdapter } from './integrations/real-jira';
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
  jira: JiraAdapter;
  github: GitHubAdapter & { injectFailureOnce: boolean };
  slack: SlackAdapter & { outbox: readonly SlackMessage[] };
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
  // External SDLC tools: live services when TOOLS_MODE=real (credentials required),
  // otherwise fully-functional offline mocks.
  const toolsReal = config.toolsMode === 'real';
  if (toolsReal) {
    const missing = [
      !config.github.token && 'GITHUB_TOKEN',
      !config.slack.botToken && 'SLACK_BOT_TOKEN',
      !config.slack.channelId && 'SLACK_CHANNEL_ID',
      !config.jira.baseUrl && 'JIRA_BASE_URL',
      !config.jira.apiToken && 'JIRA_API_TOKEN',
    ].filter(Boolean);
    if (missing.length) throw new Error(`TOOLS_MODE=real but missing: ${missing.join(', ')}`);
  }
  const jira = toolsReal ? new RealJiraAdapter() : new MockJiraAdapter();
  const github = toolsReal ? new RealGitHubAdapter() : new MockGitHubAdapter();
  const slack = toolsReal ? new RealSlackAdapter() : new MockSlackAdapter();
  const confluence = new MockConfluenceAdapter();
  const manager = new ManagerAgent({ gemini, memory, bus });
  const planning = new PlanningAgent({ gemini, memory, bus });

  // iAPI Managed-Agent runner kept wired for sandboxed work (AGENT_MODE=iapi).
  const workRunner: AgentRunner =
    config.agentMode === 'iapi' ? new IapiAgentRunner() : new GeminiAgentRunner({ gemini });
  const builder = new BuilderAgent({ gemini, github, memory, bus });
  const qa = new QAAgent({ github, memory, bus });
  const supervisor = new SupervisorAgent({ gemini, memory, bus });
  const looper = new Looper({ memory, bus, gemini, jira, slack, confluence, github, manager, planning, builder, qa, supervisor });

  log.info({ agentMode: config.agentMode, toolsMode: config.toolsMode, llmMode: config.llmMode }, 'runtime ready');
  return { memory, cache, mirror, bus, runner, workRunner, gemini, jira, github, slack, confluence, manager, planning, builder, qa, supervisor, looper };
}
