/** Typed event taxonomy for the Ceil event bus (PRD 6.4). */
import { z } from 'zod';

export const EVENT_TYPES = [
  'ObjectiveReceived',
  'PlanReady',
  'TaskAssigned',
  'SandboxSpawned',
  'AgentThinking',
  'AgentToolCall',
  'ArtifactCreated',
  'TaskCompleted',
  'TaskFailed',
  'ConflictDetected',
  'RecoveryInitiated',
  'HumanApprovalRequested',
  'HumanApproved',
  'DeployRequested',
  'Deployed',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Runtime-validated event envelope. Validation on publish keeps the bus predictable. */
export const ceilEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  objectiveId: z.string().optional(),
  taskId: z.string().optional(),
  agentRole: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  timestamp: z.string().optional(),
});

export type CeilEvent = z.infer<typeof ceilEventSchema>;
