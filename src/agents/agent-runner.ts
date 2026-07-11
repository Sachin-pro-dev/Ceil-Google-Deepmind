/**
 * AgentRunner — the abstraction over a Managed Agent, shaped to the real iAPI
 * two-step model verified from the docs on 2026-07-11:
 *   1) define a custom agent once  (client.agents.create: id, base_agent,
 *      system_instruction, tools, base_environment.sources)
 *   2) run it per turn            (client.interactions.create: agent, input,
 *      environment) — reusing `environment` (environment_id) for sandbox persistence.
 *
 * Phase 1 ships the MockAgentRunner implementation of this interface. The real
 * iAPI-backed implementation (via @google/genai) is a Phase 2/3 deliverable.
 */

/** A file/repo mounted into the agent's sandbox at define time. */
export interface AgentSource {
  type: 'repository' | 'inline';
  target: string;
  source?: string; // git URL, for type 'repository'
  content?: string; // inline file contents, for type 'inline'
}

/** The definition of a role-scoped agent (created once, invoked many times). */
export interface AgentSpec {
  id: string;
  baseAgent: string; // e.g. antigravity-preview-05-2026
  systemInstruction: string;
  tools?: unknown[]; // MCP servers / function tools — exact shape verified before Phase 3
  sources?: AgentSource[];
}

/** A single turn's input to an agent (typed content parts under the hood). */
export interface RunInput {
  text: string;
}

/** The result of one agent interaction. */
export interface RunResult {
  interactionId: string;
  environmentId?: string;
  output: string;
}

/** Options threaded through a run so emitted events can be attributed. */
export interface RunOptions {
  environmentId?: string;
  objectiveId?: string;
  taskId?: string;
  role?: string;
}

export interface AgentRunner {
  /** Define (create) a role-scoped agent. Returns its agent id. */
  defineAgent(spec: AgentSpec): Promise<{ agentId: string }>;
  /** Run a defined agent for one turn. */
  run(agentId: string, input: RunInput, opts?: RunOptions): Promise<RunResult>;
}
