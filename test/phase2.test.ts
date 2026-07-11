/**
 * Phase 2 tests. The mock-mode test always runs (no key, no quota) and proves the
 * Core Trio end-to-end path. The real-service test is gated behind RUN_REAL_LLM=1
 * (+ a real GEMINI_API_KEY) so it only hits live Gemini when explicitly requested.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, type Runtime } from '../src/index';
import { config } from '../src/config';

describe('Ceil Phase 2 — Core Trio (mock mode)', () => {
  let rt: Runtime;
  let objectiveId: string;

  beforeAll(async () => {
    rt = await bootstrap();
    const objective = await rt.memory.createObjective({ prompt: 'Build a Leave Management module' });
    objectiveId = objective.id;
    // Phases 3-4 extended the pipeline: run to the prod gate, approve, run to done.
    const last = await rt.looper.runUntilComplete(objectiveId, { tickMs: 0 });
    if (last === 'await_approval') {
      await rt.looper.approveProdDeploy(objectiveId);
      await rt.looper.runUntilComplete(objectiveId, { tickMs: 0 });
    }
  });

  it('runs Manager -> Planning -> tickets (and onward through the full pipeline)', async () => {
    const objective = await rt.memory.getObjective(objectiveId);
    expect(objective?.status).toBe('delivered');

    const tasks = await rt.memory.listTasks(objectiveId);
    expect(tasks.some((t) => t.role === 'manager' && t.status === 'completed')).toBe(true);
    const builderTasks = tasks.filter((t) => t.role !== 'manager');
    expect(builderTasks.length).toBeGreaterThanOrEqual(3);
  });

  it('creates one Jira ticket per builder task', async () => {
    const tasks = await rt.memory.listTasks(objectiveId);
    const builderTasks = tasks.filter((t) => t.role !== 'manager');
    for (const t of builderTasks) {
      const arts = await rt.memory.listArtifactsByTask(t.id);
      expect(arts.some((a) => a.type === 'jira')).toBe(true);
    }
  });

  it('records Looper decisions and the expected event types', async () => {
    const events = await rt.memory.listEvents(objectiveId);
    const types = new Set(events.map((e) => e.type));
    expect(types.has('LooperDecision')).toBe(true);
    expect(types.has('PlanReady')).toBe(true);
    expect(types.has('TaskAssigned')).toBe(true);
    expect(types.has('ArtifactCreated')).toBe(true);
  });
});

const realEnabled = process.env.RUN_REAL_LLM === '1' && !!process.env.GEMINI_API_KEY;
describe.skipIf(!realEnabled)('Ceil Phase 2 — real Gemini planning', () => {
  it('decomposes an objective into tasks via a live structured call', async () => {
    // Force real mode regardless of default config for this one test.
    process.env.LLM_MODE = 'real';
    const rt = await bootstrap();
    const objective = await rt.memory.createObjective({ prompt: 'Build a URL shortener with analytics' });
    const strategy = await rt.manager.run(objective.id, objective.prompt);
    expect(strategy.length).toBeGreaterThan(0);
    const tasks = await rt.planning.run(objective.id, objective.prompt, strategy);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });
});
