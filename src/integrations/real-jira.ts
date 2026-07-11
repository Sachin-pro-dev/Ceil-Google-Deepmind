/**
 * RealJiraAdapter — live Jira Cloud REST v3 integration (TOOLS_MODE=real): files
 * real tickets in the configured project (auto-discovers the first project when
 * JIRA_PROJECT_KEY is unset). Verified live against the Atlassian site on 2026-07-11.
 */
import { Buffer } from 'node:buffer';
import { config } from '../config';
import { childLogger } from '../logger';
import type { JiraAdapter, JiraTicket } from './jira';

const log = childLogger('real-jira');

export class RealJiraAdapter implements JiraAdapter {
  private projectKey = config.jira.projectKey;

  private auth(): string {
    const token = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`, 'utf-8').toString('base64');
    return `Basic ${token}`;
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${config.jira.baseUrl}${path}`, {
      method,
      headers: { Authorization: this.auth(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Jira ${method} ${path} HTTP ${res.status}: ${t.slice(0, 250)}`);
    }
    return (await res.json()) as T;
  }

  /** Resolve (and cache) the target project key. */
  private async project(): Promise<string> {
    if (!this.projectKey) {
      const data = await this.api<{ values: Array<{ key: string }> }>('GET', '/rest/api/3/project/search');
      if (!data.values[0]) throw new Error('no Jira projects visible to this token');
      this.projectKey = data.values[0].key;
      log.info({ projectKey: this.projectKey }, 'auto-discovered Jira project');
    }
    return this.projectKey;
  }

  async createTicket(input: { title: string; description: string }): Promise<JiraTicket> {
    const key = await this.project();
    const issue = await this.api<{ key: string }>('POST', '/rest/api/3/issue', {
      fields: {
        project: { key },
        issuetype: { name: 'Task' },
        summary: input.title.slice(0, 250),
        description: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: input.description || input.title }] }],
        },
      },
    });
    const ticket: JiraTicket = {
      key: issue.key,
      url: `${config.jira.baseUrl}/browse/${issue.key}`,
      title: input.title,
    };
    log.info({ key: issue.key }, 'filed real Jira ticket');
    return ticket;
  }
}
