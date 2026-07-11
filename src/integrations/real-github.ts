/**
 * RealGitHubAdapter — live GitHub REST integration (TOOLS_MODE=real): creates real
 * branches, commits real generated code files via the Contents API, opens real PRs,
 * and inspects real check runs. Verified live against the demo repo on 2026-07-11.
 * Idempotent where GitHub allows: existing branches/PRs are reused, existing files
 * updated in place.
 */
import { Buffer } from 'node:buffer';
import { config } from '../config';
import { childLogger } from '../logger';
import type { GitHubAdapter, GitCommit, PullRequest, CheckRun, FileChange } from './github';

const log = childLogger('real-github');

export class RealGitHubAdapter implements GitHubAdapter {
  /** Demo lever parity with the mock: force the first check run to report failure. */
  injectFailureOnce = false;
  private failureInjected = false;
  private defaultBranch: string | undefined;
  private repo = config.github.repo;

  private async api<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<T> {
    const res = await fetch(`${config.github.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.github.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && !okStatuses.includes(res.status)) {
      const t = await res.text();
      throw new Error(`GitHub ${method} ${path} HTTP ${res.status}: ${t.slice(0, 250)}`);
    }
    return (await res.json().catch(() => ({}))) as T;
  }

  /** Resolve (and cache) the repo's default branch. */
  private async base(): Promise<string> {
    if (!this.defaultBranch) {
      const repo = await this.api<{ default_branch: string }>('GET', `/repos/${this.repo}`);
      this.defaultBranch = repo.default_branch;
    }
    return this.defaultBranch;
  }

  async createBranch(name: string): Promise<{ branch: string }> {
    const base = await this.base();
    // 409 = repository is empty (no initial commit): bootstrap it with a README.
    let ref = await this.api<{ object?: { sha: string } }>(
      'GET',
      `/repos/${this.repo}/git/ref/heads/${base}`,
      undefined,
      [409],
    );
    if (!ref.object) {
      log.info({ base }, 'repo is empty; creating initial commit');
      await this.api('PUT', `/repos/${this.repo}/contents/README.md`, {
        message: 'chore: initialize repository (Ceil)',
        content: Buffer.from('# Ceil demo repo\n\nInitialized by Ceil.\n', 'utf-8').toString('base64'),
        branch: base,
      });
      ref = await this.api<{ object: { sha: string } }>('GET', `/repos/${this.repo}/git/ref/heads/${base}`);
    }
    // 422 = branch already exists; reuse it.
    await this.api('POST', `/repos/${this.repo}/git/refs`, { ref: `refs/heads/${name}`, sha: ref.object!.sha }, [422]);
    log.info({ branch: name }, 'branch ready');
    return { branch: name };
  }

  async commit(branch: string, message: string, files: FileChange[]): Promise<GitCommit> {
    if (files.length === 0) throw new Error('RealGitHubAdapter.commit called with no files');
    let lastSha = '';
    for (const f of files) {
      // Existing file? Need its blob sha to update.
      const existing = await this.api<{ sha?: string }>(
        'GET',
        `/repos/${this.repo}/contents/${f.path}?ref=${encodeURIComponent(branch)}`,
        undefined,
        [404],
      );
      const result = await this.api<{ commit: { sha: string; html_url: string } }>(
        'PUT',
        `/repos/${this.repo}/contents/${f.path}`,
        {
          message: `${message} (${f.path})`,
          content: Buffer.from(f.content, 'utf-8').toString('base64'),
          branch,
          ...(existing.sha ? { sha: existing.sha } : {}),
        },
      );
      lastSha = result.commit.sha;
      log.info({ path: f.path, sha: lastSha }, 'committed file');
    }
    return { sha: lastSha, url: `https://github.com/${this.repo}/commit/${lastSha}`, message };
  }

  async openPR(input: { branch: string; title: string }): Promise<PullRequest> {
    const base = await this.base();
    const created = await this.api<{ number?: number; html_url?: string }>(
      'POST',
      `/repos/${this.repo}/pulls`,
      { title: input.title.slice(0, 250), head: input.branch, base, body: 'Opened autonomously by Ceil.' },
      [422], // PR for this head may already exist
    );
    if (created.number) {
      log.info({ pr: created.number }, 'opened real PR');
      return { number: created.number, url: created.html_url!, title: input.title, branch: input.branch };
    }
    // Reuse the existing open PR for this branch.
    const owner = this.repo.split('/')[0];
    const existing = await this.api<Array<{ number: number; html_url: string }>>(
      'GET',
      `/repos/${this.repo}/pulls?head=${owner}:${encodeURIComponent(input.branch)}&state=open`,
    );
    if (!existing[0]) throw new Error(`could not open or find a PR for branch ${input.branch}`);
    log.info({ pr: existing[0].number }, 'reusing existing PR');
    return { number: existing[0].number, url: existing[0].html_url, title: input.title, branch: input.branch };
  }

  async runChecks(prNumber: number): Promise<CheckRun> {
    const url = `https://github.com/${this.repo}/pull/${prNumber}/checks`;
    if (this.injectFailureOnce && !this.failureInjected) {
      this.failureInjected = true;
      log.info({ pr: prNumber }, 'check run FAILED (injected demo lever)');
      return { passed: false, total: 8, failed: 2, url };
    }
    const pr = await this.api<{ head: { sha: string } }>('GET', `/repos/${this.repo}/pulls/${prNumber}`);
    const checks = await this.api<{ total_count: number; check_runs: Array<{ conclusion: string | null }> }>(
      'GET',
      `/repos/${this.repo}/commits/${pr.head.sha}/check-runs`,
    );
    if (checks.total_count === 0) {
      // Repo has no CI workflows configured; nothing to fail.
      log.info({ pr: prNumber }, 'no CI configured on repo; treating as pass');
      return { passed: true, total: 0, failed: 0, url };
    }
    const failed = checks.check_runs.filter((c) => c.conclusion && c.conclusion !== 'success').length;
    return { passed: failed === 0, total: checks.total_count, failed, url };
  }
}
