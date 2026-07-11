/**
 * PlanningAgent — decomposes an objective (plus the Manager's strategy) into a set
 * of role-scoped tasks via a structured Gemini call, and creates the task rows in
 * Shared Memory. It decomposes; it does not build.
 */
import { z } from 'zod';
import { config } from '../../config';
import { childLogger } from '../../logger';
import type { GeminiClient } from '../../llm/gemini';
import type { SharedMemory } from '../../memory/shared-memory';
import type { EventBus } from '../../bus/event-bus';

const log = childLogger('planning');

/** The builder roles Planning may assign work to. */
export const BUILDER_ROLES = ['backend', 'frontend', 'database', 'qa'] as const;

const planSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        role: z.enum(BUILDER_ROLES),
      }),
    )
    .min(1),
});
export type Plan = z.infer<typeof planSchema>;

const planningPrompt = (objective: string, strategy: string) =>
  `You are Ceil's Planning Agent. Decompose the objective into 3-6 concrete engineering ` +
  `tasks. Each task has a short title, a one-sentence description, and a role from ` +
  `[backend, frontend, database, qa]. Respond as JSON: ` +
  `{"tasks":[{"title","description","role"}]}.\n\nObjective: ${objective}\n\nStrategy: ${strategy}`;

/** Deterministic decomposition used in mock mode (and as a safe default shape). */
const cannedPlan = (objective: string): Plan => ({
  tasks: [
    { title: 'Design data schema', description: `Model the data for: ${objective}`, role: 'database' },
    { title: 'Build core APIs', description: `Implement request/approval endpoints for: ${objective}`, role: 'backend' },
    { title: 'Build dashboard UI', description: `Create the admin + user dashboard for: ${objective}`, role: 'frontend' },
    { title: 'Write acceptance tests', description: `Cover the primary flows for: ${objective}`, role: 'qa' },
  ],
});

export class PlanningAgent {
  constructor(private deps: { gemini: GeminiClient; memory: SharedMemory; bus: EventBus }) {}

  /** Produce the plan, create a task per item, and emit assignment events. */
  async run(objectiveId: string, objective: string, strategy: string) {
    await this.deps.bus.publish({
      type: 'AgentThinking',
      objectiveId,
      agentRole: 'planning',
      payload: { text: 'Decomposing objective into tasks' },
    });

    const plan = await this.deps.gemini.generateJSON<Plan>({
      model: config.models.planning,
      schema: planSchema,
      prompt: planningPrompt(objective, strategy),
      mock: cannedPlan(objective),
    });

    const created = [];
    for (const t of plan.tasks) {
      const row = await this.deps.memory.createTask({
        objectiveId,
        role: t.role,
        prompt: `${t.title}: ${t.description}`,
      });
      created.push(row);
      await this.deps.bus.publish({
        type: 'TaskAssigned',
        objectiveId,
        taskId: row.id,
        agentRole: 'planning',
        payload: { title: t.title, role: t.role },
      });
    }

    await this.deps.bus.publish({
      type: 'PlanReady',
      objectiveId,
      agentRole: 'planning',
      payload: { taskCount: created.length },
    });
    log.info({ objectiveId, taskCount: created.length }, 'plan ready');
    return created;
  }
}
