/**
 * MockAgentRunner — a local, no-network stand-in for a real iAPI Managed Agent
 * (the Phase 1 "dummy agent that logs events"). It reproduces the same OBSERVABLE
 * behavior of a real agent turn — emits lifecycle events onto the bus and writes a
 * real artifact to Shared Memory — so the entire runtime spine can be exercised
 * offline, with zero quota and no external side effects (Principle 7).
 */
import type { AgentRunner, AgentSpec, RunInput, RunOptions, RunResult } from './agent-runner';
import type { EventBus } from '../bus/event-bus';
import type { SharedMemory } from '../memory/shared-memory';
import { childLogger } from '../logger';

const log = childLogger('mock-agent');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockAgentRunner implements AgentRunner {
  private specs = new Map<string, AgentSpec>();

  constructor(private deps: { bus: EventBus; memory: SharedMemory; stepDelayMs?: number }) {}

  async defineAgent(spec: AgentSpec): Promise<{ agentId: string }> {
    this.specs.set(spec.id, spec);
    log.info({ agentId: spec.id, base: spec.baseAgent }, 'defineAgent (mock)');
    return { agentId: spec.id };
  }

  /** Simulate a full agent turn: think -> tool call -> produce artifact -> complete. */
  async run(agentId: string, input: RunInput, opts: RunOptions = {}): Promise<RunResult> {
    const role = opts.role ?? agentId;
    const base = { objectiveId: opts.objectiveId, taskId: opts.taskId, agentRole: role };
    const delay = this.deps.stepDelayMs ?? 0;
    log.info({ agentId, input: input.text }, 'run (mock)');

    await this.deps.bus.publish({ ...base, type: 'AgentThinking', payload: { text: `Planning: ${input.text}` } });
    await sleep(delay);

    await this.deps.bus.publish({
      ...base,
      type: 'AgentToolCall',
      payload: { tool: 'github.mock', action: 'open_pr' },
    });
    await sleep(delay);

    let artifactUrl = 'mock://no-task';
    if (opts.taskId) {
      const artifact = await this.deps.memory.recordArtifact({
        taskId: opts.taskId,
        type: 'code',
        externalUrl: 'https://github.com/ceil/demo/pull/1',
        metadata: { title: `PR for ${role}` },
      });
      artifactUrl = artifact.externalUrl ?? artifactUrl;
      await this.deps.bus.publish({
        ...base,
        type: 'ArtifactCreated',
        payload: { artifactId: artifact.id, type: 'code', url: artifactUrl },
      });
      await this.deps.memory.updateTaskStatus(opts.taskId, 'completed', { artifactId: artifact.id });
    }
    await sleep(delay);

    await this.deps.bus.publish({ ...base, type: 'TaskCompleted', payload: { summary: `Completed: ${input.text}` } });

    return {
      interactionId: `mock-${agentId}-${Date.now()}`,
      environmentId: opts.environmentId ?? `mock-env-${role}`,
      output: `Mock ${role} finished: ${input.text}`,
    };
  }
}
