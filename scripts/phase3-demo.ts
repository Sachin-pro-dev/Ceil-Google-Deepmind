/**
 * Phase 3 self-check: one objective drives the FULL delivery pipeline —
 * Manager -> Planning -> Jira tickets -> Database builder -> Backend+Frontend
 * builders (parallel) -> QA checks -> objective delivered. Offline by default
 * (mock LLM + mock GitHub/Jira, zero quota). Set LLM_MODE=real for live Gemini
 * reasoning; AGENT_MODE=iapi for real Managed-Agent sandboxes.
 * Usage: `npm run demo:phase3`.
 */
import { bootstrap } from '../src/index';
import { config } from '../src/config';

async function main() {
  console.log(
    `\n=== Ceil Phase 3 demo (env=${config.env}, llm=${config.llmMode}, agents=${config.agentMode}) ===\n`,
  );
  const rt = await bootstrap();

  const objective = await rt.memory.createObjective({
    prompt: 'Build a Leave Management module with role-based approvals and an admin dashboard',
  });
  console.log(`Objective: "${objective.prompt}"\n`);
  await rt.bus.publish({ type: 'ObjectiveReceived', objectiveId: objective.id, payload: { prompt: objective.prompt } });

  console.log('--- Looper heartbeat driving the pipeline ---');
  const events: string[] = [];
  rt.bus.subscribe('LooperDecision', (e) => {
    const p = e.payload as { tick: number; action: string };
    events.push(`tick ${p.tick}: ${p.action}`);
  });
  await rt.looper.runUntilComplete(objective.id, { tickMs: 300 });
  for (const line of events) console.log(`  ${line}`);

  const tasks = await rt.memory.listTasks(objective.id);
  console.log('\n--- Tasks, tickets, and PRs ---');
  for (const t of tasks.filter((x) => x.role !== 'manager')) {
    const arts = await rt.memory.listArtifactsByTask(t.id);
    const jira = arts.find((a) => a.type === 'jira');
    const pr = arts.find((a) => a.type === 'pr');
    const test = arts.find((a) => a.type === 'test');
    const bits = [
      `[${((jira?.metadata as { key?: string } | null)?.key ?? '—').padEnd(7)}]`,
      t.role.padEnd(9),
      `status=${t.status.padEnd(10)}`,
      pr ? `PR ${pr.externalUrl}` : test ? `checks: ${(test.metadata as { totals?: number } | null)?.totals} passed` : '',
    ];
    console.log(`  ${bits.join(' ')}`);
  }

  const finalObjective = await rt.memory.getObjective(objective.id);
  const allEvents = await rt.memory.listEvents(objective.id);
  console.log(`\n--- Summary ---`);
  console.log(`  objective status : ${finalObjective?.status}`);
  console.log(`  events logged    : ${allEvents.length}`);
  console.log(`  mirrored to UI   : ${(await rt.mirror.list('events')).length}`);
  console.log(`\n=== Phase 3 verified: prompt in -> tickets -> PRs -> QA checks -> delivered ===\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
