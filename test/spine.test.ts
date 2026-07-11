/**
 * Phase 1 integration test: exercises the whole spine at once (migrations, Shared
 * Memory, event bus, dual-write persistence, and the mock agent) against an
 * in-memory PGlite. This is the single high-value test for Phase 1.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, type Runtime } from '../src/index';
import { config } from '../src/config';

describe('Ceil Phase 1 spine', () => {
  let rt: Runtime;
  let objectiveId: string;
  let taskId: string;

  beforeAll(async () => {
    rt = await bootstrap({ stepDelayMs: 0 });
    const objective = await rt.memory.createObjective({ prompt: 'test objective' });
    objectiveId = objective.id;
    const task = await rt.memory.createTask({ objectiveId, role: 'backend', prompt: 'do work' });
    taskId = task.id;
    await rt.runner.defineAgent({ id: 'backend', baseAgent: config.agentBase, systemInstruction: 'test' });
    await rt.runner.run('backend', { text: 'do work' }, { objectiveId, taskId, role: 'backend' });
  });

  it('persists the full agent lifecycle to durable memory', async () => {
    const events = await rt.memory.listEvents(objectiveId);
    const types = events.map((e) => e.type);
    expect(types).toContain('AgentThinking');
    expect(types).toContain('AgentToolCall');
    expect(types).toContain('ArtifactCreated');
    expect(types).toContain('TaskCompleted');
  });

  it('records the artifact and completes the task', async () => {
    const tasks = await rt.memory.listTasks(objectiveId);
    expect(tasks[0].status).toBe('completed');
    const artifacts = await rt.memory.listArtifactsByTask(taskId);
    expect(artifacts.length).toBeGreaterThan(0);
    expect(artifacts[0].externalUrl).toContain('github.com');
  });

  it('mirrors events to the Console real-time store', async () => {
    const mirrored = await rt.mirror.list('events');
    expect(mirrored.length).toBeGreaterThanOrEqual(4);
  });
});
