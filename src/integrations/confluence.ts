/**
 * Confluence integration. Phase 5 ships a MOCK adapter (same doctrine as Jira/
 * GitHub/Slack): mints page URLs so docs/release-notes artifacts are demonstrable
 * offline. The real Confluence MCP adapter lands behind this interface later.
 */
import { childLogger } from '../logger';

const log = childLogger('confluence');

export interface ConfluencePage {
  id: string;
  url: string;
  title: string;
}

export interface ConfluenceAdapter {
  createPage(input: { title: string; content: string }): Promise<ConfluencePage>;
}

/** In-memory Confluence stand-in with deterministic page ids. */
export class MockConfluenceAdapter implements ConfluenceAdapter {
  private counter = 0;

  async createPage(input: { title: string; content: string }): Promise<ConfluencePage> {
    this.counter += 1;
    const id = `page-${this.counter}`;
    log.info({ id, title: input.title }, 'created mock Confluence page');
    return { id, url: `https://ceil.atlassian.net/wiki/${id}`, title: input.title };
  }
}
