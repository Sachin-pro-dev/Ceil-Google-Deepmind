/**
 * Ceil HTTP surface: serves the Console (dark-mode control room, static page) and
 * the JSON API it polls. Objectives run in the background — the Looper heartbeat
 * drives them while the Console watches state live. No login (localhost demo).
 * Run with `npm run dev` or `npm start`, then open http://localhost:8080.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import { bootstrap } from './index';
import { config } from './config';
import { childLogger } from './logger';

const log = childLogger('server');

export async function startServer() {
  const rt = await bootstrap();
  const app = Fastify({ logger: false });
  // Tolerate bodyless/odd-content-type POSTs (e.g. approve clicks from any client).
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, _body, done) => done(null, undefined));
  const consoleHtml = readFileSync(join(process.cwd(), 'src', 'console', 'index.html'), 'utf-8');

  /** Objectives with a Looper heartbeat currently running (prevents double loops). */
  const running = new Set<string>();

  /** Start/resume the Looper for an objective in the background. */
  const drive = (objectiveId: string) => {
    if (running.has(objectiveId)) return;
    running.add(objectiveId);
    void rt.looper
      .runUntilComplete(objectiveId)
      .catch((err) => log.error({ err, objectiveId }, 'looper run failed'))
      .finally(() => running.delete(objectiveId));
  };

  app.get('/', async (_req, reply) => reply.type('text/html').send(consoleHtml));
  app.get('/health', async () => ({
    status: 'ok',
    env: config.env,
    llm: config.llmMode,
    tools: config.toolsMode,
  }));

  /** Start a new objective; the Looper drives it in the background. */
  app.post('/api/objectives', async (req) => {
    const body = (req.body ?? {}) as { prompt?: string; injectFailure?: boolean };
    const prompt = body.prompt?.trim() || 'Build a Leave Management module';
    rt.github.injectFailureOnce = body.injectFailure ?? false;

    const objective = await rt.memory.createObjective({ prompt });
    await rt.bus.publish({ type: 'ObjectiveReceived', objectiveId: objective.id, payload: { prompt } });
    drive(objective.id);
    log.info({ objectiveId: objective.id, prompt }, 'objective started');
    return { objectiveId: objective.id };
  });

  /** Full state snapshot for the Console (polled). */
  app.get('/api/state/:id', async (req) => {
    const { id } = req.params as { id: string };
    const [objective, tasks, events, decisions, artifacts] = await Promise.all([
      rt.memory.getObjective(id),
      rt.memory.listTasks(id),
      rt.memory.listEvents(id),
      rt.memory.listDecisions(id),
      rt.memory.listArtifacts(id),
    ]);
    return {
      objective,
      tasks,
      events: events.slice(0, 60),
      decisions: decisions.slice(0, 10),
      artifacts,
      slackOutbox: rt.slack.outbox.slice(-5),
      autonomyLevel: objective?.autonomyLevel ?? 4,
    };
  });

  /** Governance gate: human approves the production deploy. */
  app.post('/api/approve/:id', async (req) => {
    const { id } = req.params as { id: string };
    await rt.looper.approveProdDeploy(id);
    drive(id);
    return { approved: true };
  });

  /** List user-defined custom agents (Console sidebar). */
  app.get('/api/agents', async () => ({ agents: await rt.memory.listCustomAgents() }));

  /** Create a custom agent from a name + description. */
  app.post('/api/agents', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; description?: string };
    const name = body.name?.trim();
    const description = body.description?.trim();
    if (!name || !description) {
      reply.code(400);
      return { error: 'name and description are required' };
    }
    const agent = await rt.memory.createCustomAgent({ name, description });
    log.info({ slug: agent.slug }, 'custom agent created');
    return { agent };
  });

  /**
   * Drop an agent into a running workflow: creates a task for it (persona folded
   * into the prompt), files a Jira ticket, re-opens QA, reactivates the pipeline,
   * and resumes the Looper. `agentId` = custom agent; `role` = extra built-in
   * builder (backend/frontend/database).
   */
  app.post('/api/objectives/:id/add-agent', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { agentId?: string; role?: string };
    const objective = await rt.memory.getObjective(id);
    if (!objective) {
      reply.code(404);
      return { error: 'objective not found' };
    }

    let role: string;
    let prompt: string;
    if (body.agentId) {
      const agent = await rt.memory.getCustomAgent(body.agentId);
      if (!agent) {
        reply.code(404);
        return { error: 'agent not found' };
      }
      role = agent.slug;
      prompt = `You are "${agent.name}": ${agent.description}. Apply your specialty to the objective: ${objective.prompt}`;
    } else if (body.role && ['backend', 'frontend', 'database'].includes(body.role)) {
      role = body.role;
      prompt = `Additional ${body.role} workstream requested by the user for the objective: ${objective.prompt}`;
    } else {
      reply.code(400);
      return { error: 'agentId or a builder role is required' };
    }

    const task = await rt.memory.createTask({ objectiveId: id, role, prompt });
    await rt.bus.publish({
      type: 'TaskAssigned',
      objectiveId: id,
      taskId: task.id,
      agentRole: 'looper',
      payload: { role, source: 'drag-drop', title: prompt.slice(0, 80) },
    });
    // Real Jira ticket for the new workstream.
    const ticket = await rt.jira.createTicket({ title: prompt.slice(0, 120), description: prompt });
    await rt.memory.recordArtifact({
      taskId: task.id,
      type: 'jira',
      externalUrl: ticket.url,
      metadata: { key: ticket.key, title: ticket.title },
    });
    await rt.bus.publish({
      type: 'ArtifactCreated',
      objectiveId: id,
      taskId: task.id,
      agentRole: 'planning',
      payload: { tool: 'jira', key: ticket.key, url: ticket.url },
    });

    // Re-open verification and (if already shipped/gated) reactivate the pipeline.
    const tasks = await rt.memory.listTasks(id);
    const qa = tasks.find((t) => t.role === 'qa' && t.status === 'completed');
    if (qa) await rt.memory.updateTaskStatus(qa.id, 'pending');
    if (['staged', 'approved', 'delivered'].includes(objective.status)) {
      await rt.memory.updateObjectiveStatus(id, 'active');
    }
    drive(id);
    log.info({ objectiveId: id, role }, 'agent dropped into workflow');
    return { task };
  });

  /** Simulated inbound Slack message (the live-replanning demo lever). */
  app.post('/api/slack', async (req) => {
    const body = (req.body ?? {}) as { text?: string };
    const text = body.text?.trim();
    if (!text) return { queued: false };
    await rt.slack.pushInbound(text);
    return { queued: true };
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  log.info({ port: config.port }, `Ceil Console at http://localhost:${config.port}`);
  return app;
}

startServer().catch((err) => {
  log.error(err);
  process.exit(1);
});
