/**
 * Minimal HTTP surface for the runtime skeleton: a health check and an objective
 * trigger that runs the (mock) agent end-to-end. Kept intentionally small — the
 * full API grows in later phases. Run with `npm run dev` or `npm start`.
 */
import Fastify from 'fastify';
import { bootstrap } from './index';
import { config } from './config';
import { childLogger } from './logger';

const log = childLogger('server');

export async function startServer() {
  const rt = await bootstrap();
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok', env: config.env }));

  app.post('/objectives', async (req) => {
    const body = (req.body ?? {}) as { prompt?: string; role?: string };
    const prompt = body.prompt ?? 'Build a Leave Management module';
    const role = body.role ?? 'backend';

    const objective = await rt.memory.createObjective({ prompt });
    await rt.bus.publish({ type: 'ObjectiveReceived', objectiveId: objective.id, payload: { prompt } });

    const task = await rt.memory.createTask({ objectiveId: objective.id, role, prompt });
    await rt.runner.defineAgent({
      id: role,
      baseAgent: config.agentBase,
      systemInstruction: `You are Ceil's ${role} agent.`,
    });
    await rt.runner.run(role, { text: prompt }, { objectiveId: objective.id, taskId: task.id, role });

    const events = await rt.memory.listEvents(objective.id);
    return { objectiveId: objective.id, events };
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  log.info({ port: config.port }, 'server listening');
  return app;
}

startServer().catch((err) => {
  log.error(err);
  process.exit(1);
});
