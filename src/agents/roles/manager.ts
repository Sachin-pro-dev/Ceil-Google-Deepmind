/**
 * ManagerAgent — produces a high-level delivery strategy for an objective via a
 * direct Gemini reasoning call, and writes it to Shared Memory. It does not write
 * code or file tickets; that is Planning's and the builders' job (role boundaries).
 */
import { config } from '../../config';
import { childLogger } from '../../logger';
import type { GeminiClient } from '../../llm/gemini';
import type { SharedMemory } from '../../memory/shared-memory';
import type { EventBus } from '../../bus/event-bus';

const log = childLogger('manager');

const managerPrompt = (objective: string) =>
  `You are Ceil's Manager Agent. Given the objective below, write a concise (3-5 sentence) ` +
  `delivery strategy: the major components to build and the order to build them. ` +
  `Do not write code or list tickets.\n\nObjective: ${objective}`;

export class ManagerAgent {
  constructor(private deps: { gemini: GeminiClient; memory: SharedMemory; bus: EventBus }) {}

  /** Generate the strategy, persist it on a 'manager' task, and return the text. */
  async run(objectiveId: string, objective: string): Promise<string> {
    const task = await this.deps.memory.createTask({ objectiveId, role: 'manager', prompt: objective });
    await this.deps.bus.publish({
      type: 'AgentThinking',
      objectiveId,
      taskId: task.id,
      agentRole: 'manager',
      payload: { text: 'Devising delivery strategy' },
    });

    const strategy = await this.deps.gemini.generateText({
      model: config.models.manager,
      prompt: managerPrompt(objective),
      mock:
        `Strategy: deliver "${objective}" in four parallel workstreams — a database schema, ` +
        `backend APIs, a frontend dashboard, and QA tests. Build the schema and core request ` +
        `flow first, then layer approvals, notifications, and the admin view.`,
    });

    await this.deps.memory.updateTaskStatus(task.id, 'completed', { strategy });
    await this.deps.bus.publish({
      type: 'TaskCompleted',
      objectiveId,
      taskId: task.id,
      agentRole: 'manager',
      payload: { summary: 'Strategy ready' },
    });
    log.info({ objectiveId }, 'strategy produced');
    return strategy;
  }
}
