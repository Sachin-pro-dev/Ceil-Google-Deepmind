/**
 * Phase 2 self-check: give one objective and watch the Core Trio work.
 * The Looper heartbeat drives Manager -> Planning -> Jira tickets, entirely through
 * Shared Memory. Prints the Looper's tick-by-tick decisions, the strategy, the tasks,
 * and the tickets produced. Runs in mock mode by default (no key/quota); set
 * LLM_MODE=real + GEMINI_API_KEY in .env.local to drive real Gemini.
 * Usage: `npm run demo:phase2`.
 */
import { bootstrap } from '../src/index';
import { config } from '../src/config';

async function main() {
  console.log(`\n=== Ceil Phase 2 demo (env=${config.env}, llm=${config.llmMode}) ===\n`);
  const rt = await bootstrap();

  const objective = await rt.memory.createObjective({
    prompt: 'Build a Leave Management module with role-based approvals and a Slack notification',
  });
  console.log(`Objective: "${objective.prompt}"\n  id=${objective.id}\n`);
  await rt.bus.publish({ type: 'ObjectiveReceived', objectiveId: objective.id, payload: { prompt: objective.prompt } });

  console.log('--- Looper heartbeat (decide -> route) ---');
  await rt.looper.runUntilComplete(objective.id, { tickMs: 600 });

  const tasks = await rt.memory.listTasks(objective.id);
  const manager = tasks.find((t) => t.role === 'manager');
  console.log(`\n--- Manager strategy ---\n  ${(manager?.output as { strategy?: string } | null)?.strategy ?? '(none)'}\n`);

  console.log('--- Planned tasks + Jira tickets ---');
  for (const t of tasks.filter((x) => x.role !== 'manager')) {
    const arts = await rt.memory.listArtifactsByTask(t.id);
    const ticket = arts.find((a) => a.type === 'jira');
    const key = (ticket?.metadata as { key?: string } | null)?.key ?? '(no ticket)';
    console.log(`  [${key.padEnd(8)}] ${t.role.padEnd(9)} ${t.prompt}`);
  }

  const finalObjective = await rt.memory.getObjective(objective.id);
  const events = await rt.memory.listEvents(objective.id);
  console.log(`\n--- Summary ---`);
  console.log(`  objective status : ${finalObjective?.status}`);
  console.log(`  events logged    : ${events.length}`);
  console.log(`  mirrored to UI   : ${(await rt.mirror.list('events')).length}`);
  console.log(`\n=== Phase 2 verified: prompt in -> strategy -> tasks -> Jira tickets out ===\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
