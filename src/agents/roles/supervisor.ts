/**
 * SupervisorAgent — the conflict/failure recovery tier (PRD 3.3). It detects
 * failures by READING SHARED MEMORY (never by receiving another agent's chat),
 * diagnoses via a Gemini reasoning call, emits ConflictDetected + RecoveryInitiated,
 * creates a fix task for the responsible builder with the failure context folded in,
 * and resets the verifier task so QA re-runs after the fix lands.
 */
import { config } from '../../config';
import { childLogger } from '../../logger';
import type { GeminiClient } from '../../llm/gemini';
import type { SharedMemory } from '../../memory/shared-memory';
import type { EventBus } from '../../bus/event-bus';

const log = childLogger('supervisor');

export interface FailedTask {
  id: string;
  objectiveId: string;
  role: string;
  prompt: string | null;
  output: unknown;
}

export class SupervisorAgent {
  constructor(private deps: { gemini: GeminiClient; memory: SharedMemory; bus: EventBus }) {}

  /**
   * Recover from a failed verifier task: diagnose, re-task the builder, reset QA.
   * Returns the created fix task.
   */
  async recover(failed: FailedTask) {
    const base = { objectiveId: failed.objectiveId, agentRole: 'supervisor' };
    const failureContext = JSON.stringify(failed.output ?? {});

    const diagnosis = await this.deps.gemini.generateText({
      model: config.models.flash,
      prompt:
        `You are Ceil's Supervisor Agent. QA checks failed with: ${failureContext}. ` +
        `In two sentences, diagnose the likely cause and name which builder role must fix it.`,
      mock:
        `Detected failing checks in the backend request endpoints (schema mismatch on the ` +
        `approval payload). Re-tasking the Backend Agent with the failure context.`,
    });

    await this.deps.bus.publish({
      ...base,
      taskId: failed.id,
      type: 'ConflictDetected',
      payload: { diagnosis, failedTaskId: failed.id },
    });

    const fixTask = await this.deps.memory.createTask({
      objectiveId: failed.objectiveId,
      role: 'backend',
      prompt: `Fix failing QA checks. Failure context: ${failureContext}. Diagnosis: ${diagnosis}`,
    });

    // Reset the verifier so QA re-runs once the fix lands.
    await this.deps.memory.updateTaskStatus(failed.id, 'pending');

    await this.deps.bus.publish({
      ...base,
      taskId: fixTask.id,
      type: 'RecoveryInitiated',
      payload: { diagnosis, fixTaskId: fixTask.id, retaskedRole: 'backend' },
    });
    log.info({ fixTaskId: fixTask.id }, 'recovery initiated');
    return fixTask;
  }
}
