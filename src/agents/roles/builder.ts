/**
 * BuilderAgent — executes one builder task (backend / frontend / database): asks
 * Gemini to produce the actual code files for the task (structured output), then
 * publishes the work as GitHub artifacts (branch -> commit of the real files ->
 * PR) and records everything (including the file contents, for the Console's code
 * view) in Shared Memory. Builders build; they do not plan, test, or merge.
 */
import { z } from 'zod';
import { config } from '../../config';
import { childLogger } from '../../logger';
import type { GeminiClient } from '../../llm/gemini';
import type { GitHubAdapter, FileChange } from '../../integrations/github';
import type { SharedMemory } from '../../memory/shared-memory';
import type { EventBus } from '../../bus/event-bus';

const log = childLogger('builder');

/** Turn a task prompt into a safe branch slug. */
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const workSchema = z.object({
  summary: z.string(),
  files: z
    .array(z.object({ path: z.string().min(1), content: z.string().min(1) }))
    .min(1)
    .max(4),
});
type Work = z.infer<typeof workSchema>;

const workPrompt = (role: string, task: string) =>
  `You are Ceil's ${role} agent on a software delivery team. Implement exactly this task, ` +
  `nothing more:\n\n"${task}"\n\nProduce 1-3 small, self-contained, production-quality code ` +
  `files (with comments). Use TypeScript for backend/frontend work and SQL for database work. ` +
  `File paths must be relative, under "src/${role}/". Respond as JSON: ` +
  `{"summary": "<2 sentences on what you built>", "files": [{"path": "...", "content": "..."}]}.`;

/** Deterministic sample used in mock LLM mode so the flow stays fully offline-runnable. */
const cannedWork = (role: string, task: string): Work => ({
  summary: `Implemented "${task}" as the ${role} agent: one module with its core logic wired in.`,
  files: [
    {
      path: `src/${role}/${slugify(task) || 'module'}.${role === 'database' ? 'sql' : 'ts'}`,
      content:
        role === 'database'
          ? `-- ${task}\nCREATE TABLE IF NOT EXISTS leave_requests (\n  id SERIAL PRIMARY KEY,\n  employee_id INT NOT NULL,\n  status TEXT NOT NULL DEFAULT 'pending',\n  created_at TIMESTAMPTZ NOT NULL DEFAULT now()\n);\n`
          : `// ${task}\nexport function handle(input: { employeeId: number }) {\n  // Core logic for: ${task}\n  return { ok: true, employeeId: input.employeeId };\n}\n`,
    },
  ],
});

export interface BuilderTask {
  id: string;
  objectiveId: string;
  role: string;
  prompt: string;
}

export class BuilderAgent {
  constructor(
    private deps: { gemini: GeminiClient; github: GitHubAdapter; memory: SharedMemory; bus: EventBus },
  ) {}

  /** Execute one task end-to-end and return the PR it produced. */
  async run(task: BuilderTask) {
    const base = { objectiveId: task.objectiveId, taskId: task.id, agentRole: task.role };
    await this.deps.memory.updateTaskStatus(task.id, 'in_progress');
    await this.deps.bus.publish({ ...base, type: 'AgentThinking', payload: { text: task.prompt } });

    // The actual work: real code files from Gemini (canned files in mock mode).
    const work = await this.deps.gemini.generateJSON<Work>({
      model: config.models.flash,
      schema: workSchema,
      prompt: workPrompt(task.role, task.prompt),
      mock: cannedWork(task.role, task.prompt),
    });
    const files: FileChange[] = work.files;

    const branch = `feature/${task.role}-${slugify(task.prompt)}`;
    await this.deps.github.createBranch(branch);
    await this.deps.bus.publish({
      ...base,
      type: 'AgentToolCall',
      payload: { tool: 'github', action: 'commit', branch, files: files.map((f) => f.path) },
    });
    const commit = await this.deps.github.commit(branch, `${task.role}: ${task.prompt.slice(0, 80)}`, files);
    const pr = await this.deps.github.openPR({ branch, title: task.prompt.slice(0, 120) });

    const artifact = await this.deps.memory.recordArtifact({
      taskId: task.id,
      type: 'pr',
      externalUrl: pr.url,
      metadata: { number: pr.number, branch, commitSha: commit.sha, summary: work.summary },
    });
    await this.deps.bus.publish({
      ...base,
      type: 'ArtifactCreated',
      payload: { tool: 'github', artifactId: artifact.id, pr: pr.number, url: pr.url },
    });

    // Store the code itself so the Console can show what was written.
    await this.deps.memory.updateTaskStatus(task.id, 'completed', {
      summary: work.summary,
      pr: pr.number,
      prUrl: pr.url,
      files,
    });
    await this.deps.bus.publish({
      ...base,
      type: 'TaskCompleted',
      payload: { summary: `PR #${pr.number} opened (${files.length} file(s))`, pr: pr.number },
    });
    log.info({ role: task.role, pr: pr.number, files: files.length }, 'builder task completed');
    return pr;
  }
}
