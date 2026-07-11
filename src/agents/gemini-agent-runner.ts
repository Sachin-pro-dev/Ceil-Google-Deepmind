/**
 * GeminiAgentRunner — AgentRunner implementation whose "sandbox" is a direct
 * Gemini reasoning call (mock or real via LLM_MODE). This is the offline-capable
 * work engine for the builder agents: same interface as the real Managed-Agent
 * runner, so the two are swappable via AGENT_MODE config. Unlike MockAgentRunner
 * (the Phase 1 lifecycle dummy), this runner emits no events and writes no
 * artifacts — the role agents own that.
 */
import type { AgentRunner, AgentSpec, RunInput, RunOptions, RunResult } from './agent-runner';
import type { GeminiClient } from '../llm/gemini';
import { config } from '../config';
import { childLogger } from '../logger';

const log = childLogger('gemini-runner');

export class GeminiAgentRunner implements AgentRunner {
  private specs = new Map<string, AgentSpec>();

  constructor(private deps: { gemini: GeminiClient }) {}

  async defineAgent(spec: AgentSpec): Promise<{ agentId: string }> {
    this.specs.set(spec.id, spec);
    log.info({ agentId: spec.id }, 'defineAgent (gemini work engine)');
    return { agentId: spec.id };
  }

  /** One work turn: system instruction + task prompt -> work summary text. */
  async run(agentId: string, input: RunInput, opts: RunOptions = {}): Promise<RunResult> {
    const spec = this.specs.get(agentId);
    if (!spec) throw new Error(`agent "${agentId}" is not defined; call defineAgent first`);
    const role = opts.role ?? agentId;

    const output = await this.deps.gemini.generateText({
      model: config.models.flash,
      prompt:
        `${spec.systemInstruction}\n\nTask: ${input.text}\n\n` +
        `Describe concisely (3-4 sentences) the implementation you produced: ` +
        `files created/changed, key decisions, and how it satisfies the task.`,
      mock:
        `Implemented "${input.text}" as the ${role} agent: created the module files, ` +
        `wired them into the app, and validated the happy path locally. ` +
        `Key decision: kept the surface minimal and config-driven.`,
    });

    return {
      interactionId: `gemini-${agentId}-${Date.now()}`,
      environmentId: opts.environmentId ?? `gemini-env-${role}`,
      output,
    };
  }
}
