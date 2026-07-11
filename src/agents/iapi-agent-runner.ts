/**
 * IapiAgentRunner — AgentRunner implementation backed by REAL Google Managed
 * Agents via the Interactions API, using the two-step shape verified from the
 * official docs (2026-07-11):
 *   1) POST {base}/agents        {id, base_agent, system_instruction, ...}
 *   2) POST {base}/interactions  {agent, input:[{type:"text",text}], environment}
 * Reuses environment ids so sandbox state persists across turns. Selected via
 * AGENT_MODE=iapi; requires GEMINI_API_KEY. Response text is read from the
 * documented `output_text` convenience field, falling back to text parts in
 * `output`; anything else raises a clear error rather than guessing.
 */
import type { AgentRunner, AgentSpec, RunInput, RunOptions, RunResult } from './agent-runner';
import { config } from '../config';
import { childLogger } from '../logger';

const log = childLogger('iapi-runner');

export class IapiAgentRunner implements AgentRunner {
  private defined = new Set<string>();

  private headers(): Record<string, string> {
    if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is required for AGENT_MODE=iapi');
    return { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey };
  }

  /** Create the custom agent once; treat "already exists" as success (idempotent). */
  async defineAgent(spec: AgentSpec): Promise<{ agentId: string }> {
    if (this.defined.has(spec.id)) return { agentId: spec.id };
    const body: Record<string, unknown> = {
      id: spec.id,
      base_agent: spec.baseAgent,
      system_instruction: spec.systemInstruction,
    };
    if (spec.tools?.length) body.tools = spec.tools;
    if (spec.sources?.length) body.base_environment = { type: 'remote', sources: spec.sources };

    log.info({ agentId: spec.id, base: spec.baseAgent }, 'iAPI agents.create');
    const res = await fetch(`${config.iapiBaseUrl}/agents`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.iapiTimeoutMs),
    });
    if (!res.ok && res.status !== 409) {
      const t = await res.text();
      throw new Error(`iAPI agents.create HTTP ${res.status}: ${t.slice(0, 300)}`);
    }
    this.defined.add(spec.id);
    return { agentId: spec.id };
  }

  /** Run one interaction turn in the agent's sandbox. */
  async run(agentId: string, input: RunInput, opts: RunOptions = {}): Promise<RunResult> {
    const body = {
      agent: agentId,
      input: [{ type: 'text', text: input.text }],
      environment: opts.environmentId ?? 'remote',
    };
    log.info({ agentId, env: body.environment }, 'iAPI interactions.create');
    const res = await fetch(`${config.iapiBaseUrl}/interactions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.iapiTimeoutMs),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`iAPI interactions.create HTTP ${res.status}: ${t.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      id?: string;
      environment_id?: string;
      output_text?: string;
      output?: Array<{ type?: string; text?: string }>;
    };
    const output =
      data.output_text ??
      data.output?.filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n');
    if (!output) {
      throw new Error(
        `iAPI interaction returned no readable text; response keys: ${Object.keys(data).join(', ')}`,
      );
    }
    return { interactionId: data.id ?? `iapi-${Date.now()}`, environmentId: data.environment_id, output };
  }
}
