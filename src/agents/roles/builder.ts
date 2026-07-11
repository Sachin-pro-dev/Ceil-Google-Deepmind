/**
 * BuilderAgent — executes one builder task (backend / frontend / database):
 * does the work through an AgentRunner (Gemini engine or real iAPI sandbox,
 * per AGENT_MODE), then publishes the result as GitHub artifacts (branch ->
 * commit -> PR) and records everything in Shared Memory. Builders build; they
 * do not plan, test, or merge (role boundaries).
 */
import { config } from '../../config';
import { childLogger } from '../../logger';
import type { AgentRunner } from '../agent-runner';
import type { GitHubAdapter } from '../../integrations/github';
import type { SharedMemory } from '../../memory/shared-memory';
import type { EventBus } from '../../bus/event-bus';

const log = childLogger('builder');

/** Turn a task prompt into a safe branch slug. */
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export interface BuilderTask {
  id: string;
  objectiveId: string;
  role: string;
  prompt: string;
}

export class BuilderAgent {
  constructor(
    private deps: { runner: AgentRunner; github: GitHubAdapter; memory: SharedMemory; bus: EventBus },
  ) {}

  /** Execute one task end-to-end and return the PR it produced. */
  async run(task: BuilderTask) {
    const base = { objectiveId: task.objectiveId, taskId: task.id, agentRole: task.role };
    await this.deps.memory.updateTaskStatus(task.id, 'in_progress');
    await this.deps.bus.publish({ ...base, type: 'AgentThinking', payload: { text: task.prompt } });

    await this.deps.runner.defineAgent({
      id: task.role,
      baseAgent: config.agentBase,
      systemInstruction:
        `You are Ceil's ${task.role} agent. You implement exactly the task you are given, ` +
        `nothing more, and report what you built.`,
    });
    const result = await this.deps.runner.run(task.role, { text: task.prompt }, { ...base, role: task.role });

    const branch = `feature/${task.role}-${slugify(task.prompt)}`;
    await this.deps.github.createBranch(branch);
    await this.deps.bus.publish({
      ...base,
      type: 'AgentToolCall',
      payload: { tool: 'github', action: 'commit', branch },
    });
    const commit = await this.deps.github.commit(branch, `${task.role}: ${task.prompt}`);
    const pr = await this.deps.github.openPR({ branch, title: task.prompt });

    const artifact = await this.deps.memory.recordArtifact({
      taskId: task.id,
      type: 'pr',
      externalUrl: pr.url,
      metadata: { number: pr.number, branch, commitSha: commit.sha, summary: result.output },
    });
    await this.deps.bus.publish({
      ...base,
      type: 'ArtifactCreated',
      payload: { tool: 'github', artifactId: artifact.id, pr: pr.number, url: pr.url },
    });

    await this.deps.memory.updateTaskStatus(task.id, 'completed', {
      summary: result.output,
      pr: pr.number,
      environmentId: result.environmentId,
    });
    await this.deps.bus.publish({
      ...base,
      type: 'TaskCompleted',
      payload: { summary: `PR #${pr.number} opened`, pr: pr.number },
    });
    log.info({ role: task.role, pr: pr.number }, 'builder task completed');
    return pr;
  }
}
