/**
 * QAAgent — the verifier tier for builder output: runs CI checks (GitHub Actions
 * adapter) against every open PR for the objective, records the results as a test
 * artifact, and completes or fails its task accordingly. QA verifies; it does not
 * write feature code or merge (role boundaries).
 */
import { childLogger } from '../../logger';
import type { GitHubAdapter } from '../../integrations/github';
import type { SharedMemory } from '../../memory/shared-memory';
import type { EventBus } from '../../bus/event-bus';

const log = childLogger('qa');

export interface QATask {
  id: string;
  objectiveId: string;
  prompt: string;
}

export class QAAgent {
  constructor(private deps: { github: GitHubAdapter; memory: SharedMemory; bus: EventBus }) {}

  /** Run checks over the given PR numbers; returns true when everything passed. */
  async run(task: QATask, prNumbers: number[]): Promise<boolean> {
    const base = { objectiveId: task.objectiveId, taskId: task.id, agentRole: 'qa' };
    await this.deps.memory.updateTaskStatus(task.id, 'in_progress');
    await this.deps.bus.publish({
      ...base,
      type: 'AgentThinking',
      payload: { text: `Verifying ${prNumbers.length} PR(s)` },
    });

    const results = [];
    for (const pr of prNumbers) {
      await this.deps.bus.publish({
        ...base,
        type: 'AgentToolCall',
        payload: { tool: 'github_actions', action: 'run_checks', pr },
      });
      results.push({ pr, ...(await this.deps.github.runChecks(pr)) });
    }

    const allPassed = results.every((r) => r.passed);
    const totals = results.reduce((n, r) => n + r.total, 0);
    const failures = results.reduce((n, r) => n + r.failed, 0);

    const artifact = await this.deps.memory.recordArtifact({
      taskId: task.id,
      type: 'test',
      externalUrl: results[0]?.url,
      metadata: { results, totals, failures },
    });
    await this.deps.bus.publish({
      ...base,
      type: 'ArtifactCreated',
      payload: { tool: 'github_actions', artifactId: artifact.id, totals, failures },
    });

    if (allPassed) {
      await this.deps.memory.updateTaskStatus(task.id, 'completed', { totals, failures });
      await this.deps.bus.publish({
        ...base,
        type: 'TaskCompleted',
        payload: { summary: `${totals} checks passed across ${prNumbers.length} PR(s)` },
      });
    } else {
      await this.deps.memory.updateTaskStatus(task.id, 'failed', { totals, failures });
      await this.deps.bus.publish({
        ...base,
        type: 'TaskFailed',
        payload: { summary: `${failures}/${totals} checks failed` },
      });
    }
    log.info({ allPassed, totals, failures }, 'qa run complete');
    return allPassed;
  }
}
