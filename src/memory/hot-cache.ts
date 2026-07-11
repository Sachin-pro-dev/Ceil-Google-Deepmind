/**
 * Hot coordination cache (PRD 6.3 — the Memorystore Redis role).
 * Local implementation is an in-process Map so dev needs no Redis/Docker.
 * A Redis-backed implementation of this same interface lands in the deploy phase.
 */
export interface HotCache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  setPresence(role: string, status: string): Promise<void>;
  getPresence(): Promise<Record<string, string>>;
}

/** In-memory HotCache with optional per-key TTL. Fully functional (not a stub). */
export class InMemoryHotCache implements HotCache {
  private store = new Map<string, { value: unknown; expiresAt?: number }>();
  private presence = new Map<string, string>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    this.store.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : undefined });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async setPresence(role: string, status: string): Promise<void> {
    this.presence.set(role, status);
  }

  async getPresence(): Promise<Record<string, string>> {
    return Object.fromEntries(this.presence);
  }
}
