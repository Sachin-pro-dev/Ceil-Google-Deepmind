/**
 * Real-time mirror for the Console (PRD 6.3 — the Firestore role).
 * Local implementation keeps documents in memory and notifies subscribers via an
 * emitter, matching the subscribe semantics the Console will use against Firestore.
 */
import { EventEmitter } from 'node:events';

export interface RealtimeMirror {
  upsert(collection: string, id: string, doc: unknown): Promise<void>;
  get(collection: string, id: string): Promise<unknown>;
  list(collection: string): Promise<unknown[]>;
  subscribe(collection: string, cb: (doc: unknown) => void): () => void;
}

/** In-memory RealtimeMirror. Fully functional local stand-in for Firestore. */
export class InMemoryRealtimeMirror implements RealtimeMirror {
  private collections = new Map<string, Map<string, unknown>>();
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  private collection(name: string): Map<string, unknown> {
    let col = this.collections.get(name);
    if (!col) {
      col = new Map();
      this.collections.set(name, col);
    }
    return col;
  }

  async upsert(collection: string, id: string, doc: unknown): Promise<void> {
    this.collection(collection).set(id, doc);
    this.emitter.emit(collection, doc);
  }

  async get(collection: string, id: string): Promise<unknown> {
    return this.collection(collection).get(id);
  }

  async list(collection: string): Promise<unknown[]> {
    return [...this.collection(collection).values()];
  }

  /** Subscribe to new/updated docs in a collection. Returns an unsubscribe fn. */
  subscribe(collection: string, cb: (doc: unknown) => void): () => void {
    this.emitter.on(collection, cb);
    return () => this.emitter.off(collection, cb);
  }
}
