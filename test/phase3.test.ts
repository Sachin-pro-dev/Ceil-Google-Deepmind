/**
 * Phase 3 test: the full delivery pipeline in mock mode (no key, no quota, no
 * external side effects). Proves: builders produce PRs, QA verifies them, and the
 * Looper drives the objective to 'delivered'.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, type Runtime } from '../src/index';

describe('Ceil Phase 3 — full delivery pipeline (mock mode)', () => {
  let rt: Runtime;
  let objectiveId: string;

  beforeAll(async () => {
    rt = await bootstrap();
    const objective = await rt.memory.createObjective({ prompt: 'Build a Leave Management module' });
    objectiveId = objective.id;
    // Phase 4 added the prod governance gate: run to the gate, approve, run to done.
    const last = await rt.looper.runUntilComplete(objectiveId, { tickMs: 0 });
    if (last === 'await_approval') {
      await rt.looper.approveProdDeploy(objectiveId);
      await rt.looper.runUntilComplete(objectiveId, { tickMs: 0 });
    }
  });

  it('drives the objective to delivered', async () => {
    const objective = await rt.memory.getObjective(objectiveId);
    expect(objective?.status).toBe('delivered');
  });

  it('every builder task completes with a PR artifact', async () => {
    const tasks = await rt.memory.listTasks(objectiveId);
    const builders = tasks.filter((t) => ['backend', 'frontend', 'database'].includes(t.role));
    expect(builders.length).toBeGreaterThanOrEqual(3);
    for (const t of builders) {
      expect(t.status).toBe('completed');
      const arts = await rt.memory.listArtifactsByTask(t.id);
      expect(arts.some((a) => a.type === 'pr')).toBe(true);
    }
  });

  it('QA verifies the PRs and records a test artifact', async () => {
    const tasks = await rt.memory.listTasks(objectiveId);
    const qa = tasks.find((t) => t.role === 'qa');
    expect(qa?.status).toBe('completed');
    const arts = await rt.memory.listArtifactsByTask(qa!.id);
    const test = arts.find((a) => a.type === 'test');
    expect(test).toBeDefined();
    expect((test!.metadata as { failures: number }).failures).toBe(0);
  });

  it('the Looper walked the expected action sequence', async () => {
    const events = await rt.memory.listEvents(objectiveId);
    const actions = events
      .filter((e) => e.type === 'LooperDecision')
      .map((e) => (e.payload as { action: string }).action)
      .reverse(); // listEvents is newest-first
    expect(actions).toEqual([
      'spawn_manager',
      'spawn_planning',
      'create_tickets',
      'run_database',
      'run_builders',
      'run_qa',
      'deploy_staging',
      'await_approval',
      'deploy_prod',
      'complete',
    ]);
  });
});
