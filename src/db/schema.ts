/**
 * Shared Memory relational schema (PRD 6.3). Postgres/PGlite is the source of truth.
 * Indexes and foreign keys are declared here so migrations carry them (Principle 3).
 */
import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

/** Top-level user objectives ("build a Leave Management module"). */
export const objectives = pgTable('objectives', {
  id: uuid('id').defaultRandom().primaryKey(),
  prompt: text('prompt').notNull(),
  status: text('status').notNull().default('active'),
  autonomyLevel: integer('autonomy_level').notNull().default(4),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Role-scoped units of work derived from an objective. */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    objectiveId: uuid('objective_id').notNull().references(() => objectives.id),
    role: text('role').notNull(),
    status: text('status').notNull().default('pending'),
    dependencies: jsonb('dependencies').$type<string[]>().notNull().default([]),
    prompt: text('prompt'),
    output: jsonb('output'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byObjectiveStatus: index('tasks_objective_status_idx').on(t.objectiveId, t.status),
  }),
);

/** External artifacts produced by tasks (PRs, tickets, docs, tests). */
export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id').notNull().references(() => tasks.id),
    type: text('type').notNull(),
    externalUrl: text('external_url'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTask: index('artifacts_task_idx').on(t.taskId),
  }),
);

/** Durable append-only event log; source for the Console event stream (PRD 6.4). */
export const events = pgTable(
  'events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    objectiveId: uuid('objective_id'),
    taskId: uuid('task_id'),
    agentRole: text('agent_role'),
    type: text('type').notNull(),
    payload: jsonb('payload'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTime: index('events_time_idx').on(t.timestamp),
    byType: index('events_type_idx').on(t.type),
    byObjective: index('events_objective_idx').on(t.objectiveId),
  }),
);

/** Live Managed Agent sessions and their persistent sandbox environment ids. */
export const agentSessions = pgTable('agent_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  role: text('role').notNull(),
  environmentId: text('environment_id'),
  status: text('status').notNull().default('idle'),
  lastActive: timestamp('last_active', { withTimezone: true }).notNull().defaultNow(),
});

/** Looper decisions per tick (reasoning + emitted deltas); consumed from Phase 2. */
export const decisions = pgTable('decisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  objectiveId: uuid('objective_id'),
  tick: integer('tick').notNull(),
  looperReasoning: text('looper_reasoning'),
  deltas: jsonb('deltas'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
});
