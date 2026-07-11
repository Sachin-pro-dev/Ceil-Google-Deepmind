/**
 * In-process typed event bus (PRD 6.4 — the Cloud Pub/Sub role).
 * Every event is validated on publish, then fanned out to type-specific and
 * wildcard subscribers. A Pub/Sub-backed implementation lands in the deploy phase.
 */
import { EventEmitter } from 'node:events';
import { ceilEventSchema, type CeilEvent, type EventType } from './events';
import { childLogger } from '../logger';

const log = childLogger('bus');

type Handler = (evt: CeilEvent) => void | Promise<void>;

export interface EventBus {
  publish(evt: CeilEvent): Promise<void>;
  subscribe(type: EventType | '*', handler: Handler): () => void;
}

/** EventEmitter-backed bus. Fully functional (not a stub). */
export class InProcessEventBus implements EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  /** Validate the event, stamp a timestamp, then notify subscribers. */
  async publish(evt: CeilEvent): Promise<void> {
    const parsed = ceilEventSchema.parse({
      ...evt,
      timestamp: evt.timestamp ?? new Date().toISOString(),
    });
    log.info({ type: parsed.type, role: parsed.agentRole, taskId: parsed.taskId }, 'event');
    this.emitter.emit(parsed.type, parsed);
    this.emitter.emit('*', parsed);
  }

  /** Subscribe to one event type or '*' for all. Returns an unsubscribe fn. */
  subscribe(type: EventType | '*', handler: Handler): () => void {
    this.emitter.on(type, handler);
    return () => this.emitter.off(type, handler);
  }
}
