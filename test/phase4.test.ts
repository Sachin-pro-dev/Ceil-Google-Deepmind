/**
 * Phase 4 tests (mock mode, zero external side effects): Supervisor recovery after
 * an injected QA failure, mid-flight Slack replanning, and the prod governance gate.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, type Runtime } from '../src/index';

describe('Ceil Phase 4 — recovery, replanning, governance', () => {
  let rt: Runtime;
  let objectiveId: string;

  beforeAll(async () => {
    rt = await bootstrap();
    rt.github.injectFailureOnce = true;
    const objective = await rt.memory.createObjective({ prompt: 'Build a Leave Management module' });
    objectiveId = objective.id;
    // Requirement change lands mid-flight (Looper picks it up on a later tick).
    setTimeout(() => void rt.slack.pushInbound('Employees can cancel their own requests.'), 30);
    const last = await rt.looper.runUntilComplete(objectiveId, { tickMs: 25 });
    expect(last).toBe('await_approval');
  });

  it('blocks on the prod gate at staged, then delivers after human approval', async () => {
    expect((await rt.memory.getObjective(objectiveId))?.status).toBe('staged');
    const events = await rt.memory.listEvents(objectiveId);
    expect(events.some((e) => e.type === 'HumanApprovalRequested')).toBe(true);

    await rt.looper.approveProdDeploy(objectiveId);
    await rt.looper.runUntilComplete(objectiveId, { tickMs: 0 });
    expect((await rt.memory.getObjective(objectiveId))?.status).toBe('delivered');

    const after = await rt.memory.listEvents(objectiveId);
    const prodDeploy = after.find(
      (e) => e.type === 'Deployed' && (e.payload as { environment: string }).environment === 'production',
    );
    expect(prodDeploy).toBeDefined();
  });

  it('Supervisor recovered from the injected QA failure', async () => {
    const events = await rt.memory.listEvents(objectiveId);
    expect(events.some((e) => e.type === 'TaskFailed')).toBe(true);
    expect(events.some((e) => e.type === 'ConflictDetected')).toBe(true);
    expect(events.some((e) => e.type === 'RecoveryInitiated')).toBe(true);
    // The fix task exists and completed with a PR.
    const tasks = await rt.memory.listTasks(objectiveId);
    const fix = tasks.find((t) => t.prompt?.startsWith('Fix failing QA checks'));
    expect(fix?.status).toBe('completed');
  });

  it('folded the Slack requirement change in without restart', async () => {
    const tasks = await rt.memory.listTasks(objectiveId);
    const replanned = tasks.filter((t) => t.prompt?.startsWith('Requirement change from Slack'));
    expect(replanned.length).toBe(2); // backend + frontend
    for (const t of replanned) expect(t.status).toBe('completed');
    // QA ultimately passed over everything.
    const qa = tasks.find((t) => t.role === 'qa');
    expect(qa?.status).toBe('completed');
  });
});
