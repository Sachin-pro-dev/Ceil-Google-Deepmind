/**
 * Looper — Ceil's live replanner (PRD 6.5). Phase 4 maturity: on every heartbeat
 * tick it reads a bounded state snapshot from Shared Memory AND the Slack inbound
 * queue, then routes one action through the full pipeline:
 *
 *   spawn_manager -> spawn_planning -> create_tickets
 *     -> [replan]           when an unread Slack message changes requirements mid-flight
 *     -> [recover]          when the Supervisor must re-task a builder after failed QA
 *     -> run_database -> run_builders (parallel) -> run_qa
 *     -> deploy_staging     autonomous at Autonomy Level >= 4
 *     -> await_approval     prod is sensitive-tagged: blocks until a human approves
 *     -> deploy_prod -> complete
 *
 * The Looper decides and routes; role agents do the doing (generator/verifier
 * separation). Action SELECTION is deterministic; reasoning narration is Gemini.
 */
import { config } from '../config';
import { childLogger } from '../logger';
import type { GeminiClient } from '../llm/gemini';
import type { SharedMemory } from '../memory/shared-memory';
import type { EventBus } from '../bus/event-bus';
import type { JiraAdapter } from '../integrations/jira';
import type { SlackAdapter } from '../integrations/slack';
import type { ConfluenceAdapter } from '../integrations/confluence';
import type { GitHubAdapter } from '../integrations/github';
import type { ManagerAgent } from '../agents/roles/manager';
import { BUILDER_ROLES, type PlanningAgent } from '../agents/roles/planning';
import type { BuilderAgent } from '../agents/roles/builder';
import type { QAAgent } from '../agents/roles/qa';
import type { SupervisorAgent } from '../agents/roles/supervisor';

const log = childLogger('looper');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type LooperAction =
  | 'spawn_manager'
  | 'spawn_planning'
  | 'create_tickets'
  | 'replan'
  | 'recover'
  | 'run_database'
  | 'run_builders'
  | 'run_qa'
  | 'deploy_staging'
  | 'await_approval'
  | 'deploy_prod'
  | 'complete';

interface LooperState {
  objectiveStatus: string;
  managerDone: boolean;
  builderTaskCount: number;
  ticketCount: number;
  unreadSlack: number;
  failedQa: number;
  pendingDatabase: number;
  pendingCode: number;
  pendingQa: number;
}

const looperPrompt = (state: LooperState, action: LooperAction) =>
  `You are Ceil's Looper. Current state: ${JSON.stringify(state)}. You have decided the ` +
  `next action is "${action}". In one sentence, explain why this is the right next step.`;

type TaskRow = {
  id: string;
  objectiveId: string;
  role: string;
  status: string;
  prompt: string | null;
  output: unknown;
};

export class Looper {
  constructor(
    private deps: {
      memory: SharedMemory;
      bus: EventBus;
      gemini: GeminiClient;
      jira: JiraAdapter;
      slack: SlackAdapter;
      confluence: ConfluenceAdapter;
      github: GitHubAdapter;
      manager: ManagerAgent;
      planning: PlanningAgent;
      builder: BuilderAgent;
      qa: QAAgent;
      supervisor: SupervisorAgent;
    },
  ) {}

  /** Read a bounded snapshot (memory + Slack inbound) and derive the next action. */
  private async decide(objectiveId: string): Promise<{ action: LooperAction; state: LooperState }> {
    const objective = await this.deps.memory.getObjective(objectiveId);
    if (!objective) throw new Error(`objective ${objectiveId} not found`);
    const tasks = (await this.deps.memory.listTasks(objectiveId)) as TaskRow[];
    const managerDone = tasks.some((t) => t.role === 'manager' && t.status === 'completed');
    const builderTasks = tasks.filter((t) => (BUILDER_ROLES as readonly string[]).includes(t.role));
    const byStatus = (role: string, status: string) =>
      builderTasks.filter((t) => t.role === role && t.status === status).length;

    let ticketCount = 0;
    for (const bt of builderTasks) {
      const arts = await this.deps.memory.listArtifactsByTask(bt.id);
      ticketCount += arts.filter((a) => a.type === 'jira').length;
    }
    const unreadSlack = (await this.deps.slack.fetchUnread()).length;

    const state: LooperState = {
      objectiveStatus: objective.status,
      managerDone,
      builderTaskCount: builderTasks.length,
      ticketCount,
      unreadSlack,
      failedQa: byStatus('qa', 'failed'),
      pendingDatabase: byStatus('database', 'pending'),
      pendingCode: byStatus('backend', 'pending') + byStatus('frontend', 'pending'),
      pendingQa: byStatus('qa', 'pending'),
    };

    let action: LooperAction;
    if (!managerDone) action = 'spawn_manager';
    else if (builderTasks.length === 0) action = 'spawn_planning';
    else if (ticketCount === 0) action = 'create_tickets';
    else if (unreadSlack > 0) action = 'replan';
    else if (state.failedQa > 0) action = 'recover';
    else if (state.pendingDatabase > 0) action = 'run_database';
    else if (state.pendingCode > 0) action = 'run_builders';
    else if (state.pendingQa > 0) action = 'run_qa';
    else if (objective.status === 'active') action = 'deploy_staging';
    else if (objective.status === 'staged') action = 'await_approval';
    else if (objective.status === 'approved') action = 'deploy_prod';
    else action = 'complete';

    return { action, state };
  }

  /** All PR numbers + feature branches produced so far for an objective. */
  private async collectPRs(objectiveId: string): Promise<{ numbers: number[]; branches: string[] }> {
    const tasks = (await this.deps.memory.listTasks(objectiveId)) as TaskRow[];
    const numbers: number[] = [];
    const branches: string[] = [];
    for (const t of tasks) {
      const arts = await this.deps.memory.listArtifactsByTask(t.id);
      for (const a of arts) {
        if (a.type !== 'pr') continue;
        const meta = a.metadata as { number?: number; branch?: string } | null;
        if (typeof meta?.number === 'number') numbers.push(meta.number);
        if (meta?.branch && !branches.includes(meta.branch)) branches.push(meta.branch);
      }
    }
    return { numbers, branches };
  }

  /** Create a Jira ticket + artifact + event for one task. */
  private async ticketFor(objectiveId: string, task: { id: string; role: string; prompt: string | null }) {
    const ticket = await this.deps.jira.createTicket({
      title: task.prompt ?? `${task.role} task`,
      description: task.prompt ?? '',
    });
    await this.deps.memory.recordArtifact({
      taskId: task.id,
      type: 'jira',
      externalUrl: ticket.url,
      metadata: { key: ticket.key, title: ticket.title },
    });
    await this.deps.bus.publish({
      type: 'ArtifactCreated',
      objectiveId,
      taskId: task.id,
      agentRole: 'planning',
      payload: { tool: 'jira', key: ticket.key, url: ticket.url },
    });
  }

  /** Human approval hook (Console/Slack): unblock the prod gate. */
  async approveProdDeploy(objectiveId: string): Promise<void> {
    await this.deps.memory.updateObjectiveStatus(objectiveId, 'approved');
    await this.deps.bus.publish({
      type: 'HumanApproved',
      objectiveId,
      agentRole: 'manager',
      payload: { environment: 'production' },
    });
    log.info({ objectiveId }, 'prod deploy approved by human');
  }

  /** Run one Looper tick: decide, narrate, record, route. Returns the action taken. */
  async tick(objectiveId: string, tickNum: number): Promise<LooperAction> {
    const { action, state } = await this.decide(objectiveId);

    const reasoning = await this.deps.gemini.generateText({
      model: config.models.looper,
      prompt: looperPrompt(state, action),
      mock: `Tick ${tickNum}: state ${JSON.stringify(state)} implies next action "${action}".`,
    });

    await this.deps.memory.recordDecision({ objectiveId, tick: tickNum, looperReasoning: reasoning, deltas: { action } });
    await this.deps.bus.publish({
      type: 'LooperDecision',
      objectiveId,
      agentRole: 'looper',
      payload: { tick: tickNum, action, reasoning },
    });

    const objective = await this.deps.memory.getObjective(objectiveId);
    if (!objective) throw new Error(`objective ${objectiveId} not found`);
    const tasks = (await this.deps.memory.listTasks(objectiveId)) as TaskRow[];
    const pendingOf = (role: string) => tasks.filter((t) => t.role === role && t.status === 'pending');

    switch (action) {
      case 'spawn_manager':
        await this.deps.manager.run(objectiveId, objective.prompt);
        break;

      case 'spawn_planning': {
        const managerTask = tasks.find((t) => t.role === 'manager');
        const strategy = (managerTask?.output as { strategy?: string } | null)?.strategy ?? '';
        await this.deps.planning.run(objectiveId, objective.prompt, strategy);
        break;
      }

      case 'create_tickets': {
        const builderTasks = tasks.filter((t) => (BUILDER_ROLES as readonly string[]).includes(t.role));
        for (const bt of builderTasks) await this.ticketFor(objectiveId, bt);
        break;
      }

      case 'replan': {
        // Mid-flight requirement change: fold each unread Slack message into the plan.
        const messages = await this.deps.slack.fetchUnread();
        for (const msg of messages) {
          for (const role of ['backend', 'frontend'] as const) {
            const task = await this.deps.memory.createTask({
              objectiveId,
              role,
              prompt: `Requirement change from Slack (${msg.user}): ${msg.text}`,
            });
            await this.deps.bus.publish({
              type: 'TaskAssigned',
              objectiveId,
              taskId: task.id,
              agentRole: 'looper',
              payload: { role, source: 'slack', text: msg.text },
            });
            await this.ticketFor(objectiveId, task);
          }
          // Re-open verification so QA covers the new work too.
          const qaTask = tasks.find((t) => t.role === 'qa');
          if (qaTask && qaTask.status === 'completed') {
            await this.deps.memory.updateTaskStatus(qaTask.id, 'pending');
          }
        }
        await this.deps.slack.markRead(messages.map((m) => m.id));
        break;
      }

      case 'recover': {
        const failed = tasks.find((t) => t.role === 'qa' && t.status === 'failed');
        if (failed) await this.deps.supervisor.recover(failed);
        break;
      }

      case 'run_database':
        for (const t of pendingOf('database')) {
          await this.deps.builder.run({ id: t.id, objectiveId, role: t.role, prompt: t.prompt ?? '' });
        }
        break;

      case 'run_builders': {
        const code = [...pendingOf('backend'), ...pendingOf('frontend')];
        await Promise.all(
          code.map((t) =>
            this.deps.builder.run({ id: t.id, objectiveId, role: t.role, prompt: t.prompt ?? '' }),
          ),
        );
        break;
      }

      case 'run_qa': {
        const { numbers } = await this.collectPRs(objectiveId);
        for (const t of pendingOf('qa')) {
          await this.deps.qa.run({ id: t.id, objectiveId, prompt: t.prompt ?? '' }, numbers);
        }
        break;
      }

      case 'deploy_staging': {
        await this.deps.bus.publish({
          type: 'DeployRequested',
          objectiveId,
          agentRole: 'looper',
          payload: { environment: 'staging' },
        });
        // Autonomy Level 4: feature branches auto-merge into the staging branch.
        const { branches } = await this.collectPRs(objectiveId);
        if (branches.length) {
          await this.deps.github.createBranch(config.stagingBranch);
          for (const branch of branches) {
            await this.deps.github.mergeBranch(branch, config.stagingBranch);
          }
          await this.deps.bus.publish({
            type: 'AgentToolCall',
            objectiveId,
            agentRole: 'looper',
            payload: { tool: 'github', action: 'merge', merged: branches, into: config.stagingBranch },
          });
        }
        await this.deps.bus.publish({
          type: 'Deployed',
          objectiveId,
          agentRole: 'looper',
          payload: { environment: 'staging', url: config.stagingUrl, mergedBranches: branches.length },
        });
        await this.deps.memory.updateObjectiveStatus(objectiveId, 'staged');
        // Prod is sensitive-tagged: raise the governance gate instead of proceeding.
        await this.deps.bus.publish({
          type: 'HumanApprovalRequested',
          objectiveId,
          agentRole: 'manager',
          payload: { environment: 'production', reason: 'Production deploy requires human approval (Autonomy Level 4)' },
        });
        await this.deps.slack.postMessage(
          `Ceil: staging deployed (${config.stagingUrl}). Approve production deploy?`,
        );
        break;
      }

      case 'await_approval':
        // Gate is up; nothing to do until a human approves (Console or Slack).
        break;

      case 'deploy_prod': {
        // Human approved: promote staging into the default branch (real merge).
        const base = await this.deps.github.getDefaultBranch();
        const merge = await this.deps.github.mergeBranch(
          config.stagingBranch,
          base,
          `Ceil: release ${objective.prompt.slice(0, 60)}`,
        );
        await this.deps.bus.publish({
          type: 'AgentToolCall',
          objectiveId,
          agentRole: 'looper',
          payload: { tool: 'github', action: 'merge', merged: [config.stagingBranch], into: base, sha: merge.sha },
        });
        await this.deps.bus.publish({
          type: 'Deployed',
          objectiveId,
          agentRole: 'looper',
          payload: { environment: 'production', url: config.prodUrl, mergedTo: base },
        });
        await this.deps.memory.updateObjectiveStatus(objectiveId, 'delivered');
        // Closing beat: release notes to Confluence + Slack summary (PRD demo close).
        const done = tasks.filter((t) => t.status === 'completed');
        const page = await this.deps.confluence.createPage({
          title: `Release notes: ${objective.prompt.slice(0, 60)}`,
          content: `Delivered ${done.length} tasks. Staging: ${config.stagingUrl}. Production: ${config.prodUrl}.`,
        });
        const managerTask = tasks.find((t) => t.role === 'manager');
        if (managerTask) {
          await this.deps.memory.recordArtifact({
            taskId: managerTask.id,
            type: 'doc',
            externalUrl: page.url,
            metadata: { title: page.title },
          });
        }
        await this.deps.bus.publish({
          type: 'ArtifactCreated',
          objectiveId,
          agentRole: 'manager',
          payload: { tool: 'confluence', url: page.url, title: page.title },
        });
        await this.deps.slack.postMessage(`Ceil: production deployed (${config.prodUrl}). Release notes: ${page.url}`);
        break;
      }

      case 'complete':
        break;
    }

    return action;
  }

  /**
   * Tick on the heartbeat until the objective completes or blocks on the prod
   * approval gate, or the safety cap is hit. Returns the last action taken.
   */
  async runUntilComplete(objectiveId: string, opts: { tickMs?: number } = {}): Promise<LooperAction> {
    const tickMs = opts.tickMs ?? config.looperTickMs;
    let last: LooperAction = 'complete';
    for (let n = 1; n <= config.looperMaxTicks; n++) {
      last = await this.tick(objectiveId, n);
      if (last === 'complete' || last === 'await_approval') {
        log.info({ objectiveId, ticks: n, last }, 'looper stopping');
        return last;
      }
      await sleep(tickMs);
    }
    log.warn({ objectiveId }, 'looper hit max ticks without completing');
    return last;
  }
}
