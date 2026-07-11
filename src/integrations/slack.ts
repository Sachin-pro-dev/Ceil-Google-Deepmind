/**
 * Slack integration. Phase 4 ships a MOCK adapter (no real Slack workspace, and
 * external tools require explicit permission): an in-memory channel with an inbound
 * queue the Looper polls each tick — the mechanism behind mid-flight requirement
 * changes. The real Slack MCP adapter lands behind this same interface later.
 */
import { childLogger } from '../logger';

const log = childLogger('slack');

export interface SlackMessage {
  id: number;
  text: string;
  user: string;
  ts: string;
}

export interface SlackAdapter {
  /** Outbound: Ceil posts an update/approval request to the channel. */
  postMessage(text: string): Promise<SlackMessage>;
  /** Inbound: a human drops a message in the channel (the demo's requirement change). */
  pushInbound(text: string, user?: string): Promise<SlackMessage>;
  /** The Looper polls unread inbound messages each tick. */
  fetchUnread(): Promise<SlackMessage[]>;
  markRead(ids: number[]): Promise<void>;
}

/** In-memory Slack stand-in with an unread-inbound queue. */
export class MockSlackAdapter implements SlackAdapter {
  private counter = 0;
  private unread: SlackMessage[] = [];
  readonly outbox: SlackMessage[] = [];

  private next(text: string, user: string): SlackMessage {
    this.counter += 1;
    return { id: this.counter, text, user, ts: new Date().toISOString() };
  }

  async postMessage(text: string): Promise<SlackMessage> {
    const msg = this.next(text, 'ceil-bot');
    this.outbox.push(msg);
    log.info({ text }, 'posted to mock Slack');
    return msg;
  }

  async pushInbound(text: string, user = 'pm'): Promise<SlackMessage> {
    const msg = this.next(text, user);
    this.unread.push(msg);
    log.info({ text, user }, 'inbound mock Slack message');
    return msg;
  }

  async fetchUnread(): Promise<SlackMessage[]> {
    return [...this.unread];
  }

  async markRead(ids: number[]): Promise<void> {
    this.unread = this.unread.filter((m) => !ids.includes(m.id));
  }
}
