/**
 * Dual-write persistence: every published event is written to the durable Postgres
 * log (source of truth) and mirrored to the real-time store for the Console.
 * Postgres is authoritative; the mirror is best-effort and never blocks a write.
 */
import type { EventBus } from './event-bus';
import type { SharedMemory } from '../memory/shared-memory';
import type { RealtimeMirror } from '../memory/realtime-mirror';
import { childLogger } from '../logger';

const log = childLogger('persist');

/** Wire persistence into the bus. Returns an unsubscribe fn. */
export function attachPersistence(
  bus: EventBus,
  memory: SharedMemory,
  mirror: RealtimeMirror,
): () => void {
  return bus.subscribe('*', async (evt) => {
    try {
      const row = await memory.appendEvent(evt);
      await mirror.upsert('events', row.id, row);
    } catch (err) {
      log.error({ err, type: evt.type }, 'failed to persist event');
    }
  });
}
