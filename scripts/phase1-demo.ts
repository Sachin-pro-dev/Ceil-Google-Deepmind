/**
 * Phase 1 self-check (Principle "see it for yourself"): drives the runtime spine
 * end-to-end with the mock agent and prints the durable event log, tasks,
 * artifacts, and the Console mirror — proving handoff state flows through memory.
 * Usage: `npm run demo:phase1`.
 */
import { bootstrap } from '../src/index';
import { config } from '../src/config';

async function main() {
  console.log(`\n=== Ceil Phase 1 demo (env=${config.env}) ===\n`);
  const rt = await bootstrap({ stepDelayMs: 150 });

  const objective = await rt.memory.createObjective({ prompt: 'Build a Leave Management module' });
  console.log(`Objective created: ${objective.id}\n  "${objective.prompt}"\n`);
  await rt.bus.publish({
    type: 'ObjectiveReceived',
    objectiveId: objective.id,
    payload: { prompt: objective.prompt },
  });

  const task = await rt.memory.createTask({
    objectiveId: objective.id,
    role: 'backend',
    prompt: 'Build leave request API',
  });
  await rt.runner.defineAgent({
    id: 'backend',
    baseAgent: config.agentBase,
    systemInstruction: "You are Ceil's Backend Agent.",
  });
  await rt.runner.run(
    'backend',
    { text: 'Build leave request API' },
    { objectiveId: objective.id, taskId: task.id, role: 'backend' },
  );

  const events = await rt.memory.listEvents(objective.id);
  console.log(`\n--- Event log (durable, from Postgres/PGlite) ---`);
  for (const e of [...events].reverse()) {
    console.log(`  [${e.type.padEnd(16)}] role=${e.agentRole ?? '-'}  ${JSON.stringify(e.payload ?? {})}`);
  }

  const tasks = await rt.memory.listTasks(objective.id);
  console.log(`\n--- Tasks ---`);
  for (const t of tasks) console.log(`  ${t.role.padEnd(10)} status=${t.status}`);

  const artifacts = await rt.memory.listArtifactsByTask(task.id);
  console.log(`\n--- Artifacts ---`);
  for (const a of artifacts) console.log(`  ${a.type}  ${a.externalUrl}`);

  const mirrored = await rt.mirror.list('events');
  console.log(`\n--- Real-time mirror (Firestore stand-in for the Console) ---`);
  console.log(`  ${mirrored.length} events mirrored.\n`);

  console.log('=== Phase 1 spine verified: objective -> agent -> events -> memory + mirror ===\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
