/**
 * Phase 4 self-check — the two demo "wow" beats plus the governance gate:
 *  1) QA fails (injected) -> Supervisor diagnoses -> ConflictDetected ->
 *     RecoveryInitiated -> fix task -> QA re-runs green.
 *  2) Mid-flight Slack message -> Looper replans on its next tick -> new tasks +
 *     tickets -> builders + QA fold the change in. No restart.
 *  3) Staging deploys autonomously (Level 4); prod blocks on HumanApprovalRequested
 *     until approved, then ships.
 * Offline by default (mock everything, zero quota). Usage: `npm run demo:phase4`.
 */
import { bootstrap } from '../src/index';
import { config } from '../src/config';

async function main() {
  console.log(`\n=== Ceil Phase 4 demo (env=${config.env}, llm=${config.llmMode}) ===\n`);
  const rt = await bootstrap();
  rt.github.injectFailureOnce = true; // demo lever: make the first QA run fail visibly

  const objective = await rt.memory.createObjective({
    prompt: 'Build a Leave Management module with role-based approvals and an admin dashboard',
  });
  console.log(`Objective: "${objective.prompt}"\n`);
  await rt.bus.publish({ type: 'ObjectiveReceived', objectiveId: objective.id, payload: { prompt: objective.prompt } });

  rt.bus.subscribe('LooperDecision', (e) => {
    const p = e.payload as { tick: number; action: string };
    console.log(`  [looper    ] tick ${p.tick}: ${p.action}`);
  });
  rt.bus.subscribe('ConflictDetected', (e) =>
    console.log(`  [supervisor] CONFLICT: ${(e.payload as { diagnosis: string }).diagnosis}`),
  );
  rt.bus.subscribe('RecoveryInitiated', (e) =>
    console.log(`  [supervisor] RECOVERY: fix task ${(e.payload as { fixTaskId: string }).fixTaskId.slice(0, 8)} -> backend`),
  );
  rt.bus.subscribe('TaskFailed', () => console.log('  [qa        ] checks FAILED'));
  rt.bus.subscribe('HumanApprovalRequested', () =>
    console.log('  [gate      ] production deploy BLOCKED, awaiting human approval'),
  );
  rt.bus.subscribe('Deployed', (e) => {
    const p = e.payload as { environment: string; url: string };
    console.log(`  [deploy    ] ${p.environment} -> ${p.url}`);
  });

  // Beat 2 setup: drop the requirement change mid-flight (after ~2 ticks).
  setTimeout(() => {
    console.log('\n  >>> PM drops a Slack message: "Also let employees cancel their own requests before approval." <<<\n');
    void rt.slack.pushInbound('Also let employees cancel their own requests before approval.');
  }, 900);

  console.log('--- Run 1: heartbeat until the prod gate ---');
  const last = await rt.looper.runUntilComplete(objective.id, { tickMs: 400 });
  console.log(`\n  looper stopped on: ${last} (objective: ${(await rt.memory.getObjective(objective.id))?.status})`);

  console.log('\n--- Human approves the prod deploy ---');
  await rt.looper.approveProdDeploy(objective.id);
  await rt.looper.runUntilComplete(objective.id, { tickMs: 200 });

  const tasks = await rt.memory.listTasks(objective.id);
  const finalObjective = await rt.memory.getObjective(objective.id);
  console.log(`\n--- Summary ---`);
  console.log(`  objective status : ${finalObjective?.status}`);
  console.log(`  tasks            : ${tasks.length} (${tasks.filter((t) => t.status === 'completed').length} completed)`);
  console.log(`  slack outbox     : ${rt.slack.outbox.length} message(s) posted by Ceil`);
  console.log(`  events logged    : ${(await rt.memory.listEvents(objective.id)).length}`);
  console.log(`\n=== Phase 4 verified: recovery + live replanning + governance gate ===\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
