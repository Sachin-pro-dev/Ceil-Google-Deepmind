/**
 * GitHub + GitHub Actions integration. Phase 3 ships a MOCK adapter (the PRD's own
 * Phase 3 target is "first end-to-end feature build, OFFLINE", and real external
 * tools require explicit permission). It mints deterministic branches, commit shas,
 * PR numbers, and check runs so the full builder flow is demonstrable with zero
 * external side effects. The real GitHub MCP adapter lands behind this same
 * interface in a later phase.
 */
import { config } from '../config';
import { childLogger } from '../logger';

const log = childLogger('github');

export interface GitCommit {
  sha: string;
  url: string;
  message: string;
}

export interface PullRequest {
  number: number;
  url: string;
  title: string;
  branch: string;
}

export interface CheckRun {
  passed: boolean;
  total: number;
  failed: number;
  url: string;
}

/** A code file produced by a builder agent. */
export interface FileChange {
  path: string;
  content: string;
}

export interface GitHubAdapter {
  createBranch(name: string): Promise<{ branch: string }>;
  commit(branch: string, message: string, files: FileChange[]): Promise<GitCommit>;
  openPR(input: { branch: string; title: string }): Promise<PullRequest>;
  /** GitHub Actions: run/inspect CI checks for a PR. */
  runChecks(prNumber: number): Promise<CheckRun>;
  /** Merge `head` into `base` (real merge commit). Returns the merge sha ('' if already merged). */
  mergeBranch(head: string, base: string, message?: string): Promise<{ sha: string }>;
  /** The repo's default branch (e.g. "main"). */
  getDefaultBranch(): Promise<string>;
}

/** In-memory GitHub stand-in with deterministic shas/PR numbers under the config repo URL. */
export class MockGitHubAdapter implements GitHubAdapter {
  private commitCount = 0;
  private prCount = 0;
  private repo = config.githubRepoUrl;
  /** When true, the FIRST check run fails once (demo recovery beat). Seeded from
   *  INJECT_QA_FAILURE config; also settable at runtime by demos/tests. */
  injectFailureOnce = config.injectQaFailure;
  private failureInjected = false;

  async createBranch(name: string): Promise<{ branch: string }> {
    log.info({ branch: name }, 'created mock branch');
    return { branch: name };
  }

  async commit(branch: string, message: string, files: FileChange[]): Promise<GitCommit> {
    this.commitCount += 1;
    const sha = `c${String(this.commitCount).padStart(6, '0')}f4ce`;
    log.info({ branch, sha, files: files.map((f) => f.path) }, 'created mock commit');
    return { sha, url: `${this.repo}/commit/${sha}`, message };
  }

  async openPR(input: { branch: string; title: string }): Promise<PullRequest> {
    this.prCount += 1;
    const number = this.prCount + 100;
    log.info({ pr: number, branch: input.branch }, 'opened mock PR');
    return { number, url: `${this.repo}/pull/${number}`, title: input.title, branch: input.branch };
  }

  async mergeBranch(head: string, base: string): Promise<{ sha: string }> {
    this.commitCount += 1;
    const sha = `m${String(this.commitCount).padStart(6, '0')}e49e`;
    log.info({ head, base, sha }, 'merged mock branch');
    return { sha };
  }

  async getDefaultBranch(): Promise<string> {
    return 'main';
  }

  async runChecks(prNumber: number): Promise<CheckRun> {
    if (this.injectFailureOnce && !this.failureInjected) {
      this.failureInjected = true;
      log.info({ pr: prNumber }, 'mock GitHub Actions checks FAILED (injected)');
      return { passed: false, total: 8, failed: 2, url: `${this.repo}/pull/${prNumber}/checks` };
    }
    log.info({ pr: prNumber }, 'ran mock GitHub Actions checks');
    return { passed: true, total: 8, failed: 0, url: `${this.repo}/pull/${prNumber}/checks` };
  }
}
