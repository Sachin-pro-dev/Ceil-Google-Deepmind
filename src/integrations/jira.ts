/**
 * Jira integration. Phase 2 ships a MOCK adapter (no real Jira credentials, and
 * external tools require explicit permission) that mints ticket keys/URLs so the
 * "prompt in -> tickets out" path is fully demonstrable offline. The real Jira MCP
 * adapter (registered via iAPI) is a later-phase deliverable behind this interface.
 */
import { childLogger } from '../logger';

const log = childLogger('jira');

export interface JiraTicket {
  key: string;
  url: string;
  title: string;
}

export interface JiraAdapter {
  createTicket(input: { title: string; description: string }): Promise<JiraTicket>;
}

/** In-memory Jira stand-in that generates deterministic CEIL-N ticket keys. */
export class MockJiraAdapter implements JiraAdapter {
  private counter = 0;

  async createTicket(input: { title: string; description: string }): Promise<JiraTicket> {
    this.counter += 1;
    const key = `CEIL-${this.counter}`;
    const ticket: JiraTicket = { key, url: `https://ceil.atlassian.net/browse/${key}`, title: input.title };
    log.info({ key, title: input.title }, 'created mock Jira ticket');
    return ticket;
  }
}
