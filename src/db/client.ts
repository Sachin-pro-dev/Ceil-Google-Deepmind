/**
 * Database client. Local mode = PGlite (embedded WASM Postgres, no Docker required).
 * Cloud mode (Cloud SQL Postgres) is an explicit deploy-phase deliverable, not Phase 1.
 */
import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from './schema';
import { config } from '../config';
import { childLogger } from '../logger';

const log = childLogger('db');

export type Db = PgliteDatabase<typeof schema>;

let singleton: { db: Db; client: PGlite } | undefined;

/** Returns a lazily-initialized singleton DB handle for the current environment. */
export async function getDb(): Promise<{ db: Db; client: PGlite }> {
  if (singleton) return singleton;

  if (config.env !== 'local') {
    // Deferred by agreement: the Cloud SQL adapter is built in the GCP deploy phase.
    throw new Error(
      'Cloud DB adapter (Cloud SQL) is a deploy-phase deliverable; set CEIL_ENV=local.',
    );
  }

  const inMemory = config.pglitePath === 'memory';
  log.info({ pglitePath: inMemory ? 'memory' : config.pglitePath }, 'initializing PGlite');
  if (!inMemory) mkdirSync(config.pglitePath, { recursive: true });

  const client = inMemory ? new PGlite() : new PGlite(config.pglitePath);
  await client.waitReady;
  const db = drizzle(client, { schema });
  singleton = { db, client };
  return singleton;
}
