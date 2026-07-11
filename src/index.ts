/**
 * Assembles the Ceil runtime spine from local adapters and wires them together:
 * DB + Shared Memory + hot cache + real-time mirror + event bus (with persistence)
 * + the (mock) agent runner. This is the single composition root for Phase 1.
 */
import { getDb } from './db/client';
import { runMigrations } from './db/migrate';
import { SharedMemory } from './memory/shared-memory';
import { InMemoryHotCache } from './memory/hot-cache';
import { InMemoryRealtimeMirror } from './memory/realtime-mirror';
import { InProcessEventBus } from './bus/event-bus';
import { attachPersistence } from './bus/persist';
import { MockAgentRunner } from './agents/mock-agent-runner';
import { childLogger } from './logger';
import { config } from './config';

const log = childLogger('bootstrap');

export interface Runtime {
  memory: SharedMemory;
  cache: InMemoryHotCache;
  mirror: InMemoryRealtimeMirror;
  bus: InProcessEventBus;
  runner: MockAgentRunner;
}

/** Initialize and wire the runtime. `stepDelayMs` paces the mock agent for demos. */
export async function bootstrap(opts: { stepDelayMs?: number } = {}): Promise<Runtime> {
  log.info({ env: config.env }, 'bootstrapping Ceil runtime');
  const { db } = await getDb();
  await runMigrations();

  const memory = new SharedMemory(db);
  const cache = new InMemoryHotCache();
  const mirror = new InMemoryRealtimeMirror();
  const bus = new InProcessEventBus();
  attachPersistence(bus, memory, mirror);
  const runner = new MockAgentRunner({ bus, memory, stepDelayMs: opts.stepDelayMs });

  log.info('runtime ready');
  return { memory, cache, mirror, bus, runner };
}
