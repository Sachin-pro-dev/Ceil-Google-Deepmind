/**
 * Typed repository over Shared Memory — the SOLE handoff medium between agents
 * (PRD 3.1). No agent ever reads another agent's raw output; everything flows
 * through these authoritative reads and writes.
 */
import { eq, desc } from 'drizzle-orm';
import type { Db } from '../db/client';
import { objectives, tasks, artifacts, events, agentSessions, decisions } from '../db/schema';
import type { CeilEvent } from '../bus/events';
import { childLogger } from '../logger';

const log = childLogger('memory');

export class SharedMemory {
  constructor(private db: Db) {}

  /** Create a new top-level objective. */
  async createObjective(input: { prompt: string; autonomyLevel?: number }) {
    log.info({ prompt: input.prompt }, 'createObjective');
    const [row] = await this.db
      .insert(objectives)
      .values({ prompt: input.prompt, autonomyLevel: input.autonomyLevel ?? 4 })
      .returning();
    return row;
  }

  /** Fetch a single objective by id. */
  async getObjective(id: string) {
    const [row] = await this.db.select().from(objectives).where(eq(objectives.id, id));
    return row;
  }

  /** Create a task under an objective (default status 'pending'). */
  async createTask(input: {
    objectiveId: string;
    role: string;
    prompt?: string;
    dependencies?: string[];
  }) {
    log.info({ objectiveId: input.objectiveId, role: input.role }, 'createTask');
    const [row] = await this.db
      .insert(tasks)
      .values({
        objectiveId: input.objectiveId,
        role: input.role,
        prompt: input.prompt,
        dependencies: input.dependencies ?? [],
      })
      .returning();
    return row;
  }

  /** Update a task's status and optionally attach its structured output. */
  async updateTaskStatus(id: string, status: string, output?: unknown) {
    const [row] = await this.db
      .update(tasks)
      .set({ status, ...(output !== undefined ? { output } : {}), updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    return row;
  }

  /** List all tasks for an objective. */
  async listTasks(objectiveId: string) {
    return this.db.select().from(tasks).where(eq(tasks.objectiveId, objectiveId));
  }

  /** Record an external artifact produced by a task. */
  async recordArtifact(input: {
    taskId: string;
    type: string;
    externalUrl?: string;
    metadata?: unknown;
  }) {
    const [row] = await this.db
      .insert(artifacts)
      .values({
        taskId: input.taskId,
        type: input.type,
        externalUrl: input.externalUrl,
        metadata: input.metadata,
      })
      .returning();
    return row;
  }

  /** List artifacts produced by a given task. */
  async listArtifactsByTask(taskId: string) {
    return this.db.select().from(artifacts).where(eq(artifacts.taskId, taskId));
  }

  /** Append an event to the durable log (source for the Console event stream). */
  async appendEvent(evt: CeilEvent) {
    const [row] = await this.db
      .insert(events)
      .values({
        objectiveId: evt.objectiveId,
        taskId: evt.taskId,
        agentRole: evt.agentRole,
        type: evt.type,
        payload: (evt.payload ?? null) as unknown,
      })
      .returning();
    return row;
  }

  /** List events, newest first, optionally scoped to one objective. */
  async listEvents(objectiveId?: string) {
    if (objectiveId) {
      return this.db
        .select()
        .from(events)
        .where(eq(events.objectiveId, objectiveId))
        .orderBy(desc(events.timestamp));
    }
    return this.db.select().from(events).orderBy(desc(events.timestamp));
  }

  /** Register or refresh a Managed Agent session row. */
  async upsertAgentSession(input: { role: string; environmentId?: string; status?: string }) {
    const [row] = await this.db
      .insert(agentSessions)
      .values({
        role: input.role,
        environmentId: input.environmentId,
        status: input.status ?? 'idle',
      })
      .returning();
    return row;
  }

  /** Persist a Looper decision for a tick (consumed from Phase 2). */
  async recordDecision(input: {
    objectiveId?: string;
    tick: number;
    looperReasoning?: string;
    deltas?: unknown;
  }) {
    const [row] = await this.db
      .insert(decisions)
      .values({
        objectiveId: input.objectiveId,
        tick: input.tick,
        looperReasoning: input.looperReasoning,
        deltas: input.deltas,
      })
      .returning();
    return row;
  }

  /** Bounded state snapshot for the Looper (Phase 2 will consume this). */
  async snapshot(objectiveId: string) {
    const [objective, taskRows, eventRows] = await Promise.all([
      this.getObjective(objectiveId),
      this.listTasks(objectiveId),
      this.db
        .select()
        .from(events)
        .where(eq(events.objectiveId, objectiveId))
        .orderBy(desc(events.timestamp))
        .limit(20),
    ]);
    return { objective, tasks: taskRows, recentEvents: eventRows };
  }
}
