/**
 * RealSlackAdapter — live Slack Web API integration (TOOLS_MODE=real): posts real
 * messages to the configured channel and polls conversations.history for inbound
 * human messages (the live-replanning trigger). Messages sent via the Console's
 * "Send as PM" box are posted to the real channel prefixed "[PM]" so the Looper
 * treats them as inbound. Verified live against the Ceil workspace on 2026-07-11.
 */
import { config } from '../config';
import { childLogger } from '../logger';
import type { SlackAdapter, SlackMessage } from './slack';

const log = childLogger('real-slack');

interface SlackHistoryMessage {
  ts: string;
  text?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
}

export class RealSlackAdapter implements SlackAdapter {
  readonly outbox: SlackMessage[] = [];
  /** Only messages after adapter start count as inbound (old history is ignored). */
  private lastTs = String(Date.now() / 1000);
  private idToTs = new Map<number, string>();
  private counter = 0;

  private async api<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${config.slack.apiUrl}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.slack.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(params),
    });
    const data = (await res.json()) as T & { ok: boolean; error?: string };
    if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`);
    return data;
  }

  async postMessage(text: string): Promise<SlackMessage> {
    const data = await this.api<{ ts: string }>('chat.postMessage', {
      channel: config.slack.channelId,
      text,
    });
    this.counter += 1;
    const msg: SlackMessage = { id: this.counter, text, user: 'ceil-bot', ts: data.ts };
    this.outbox.push(msg);
    log.info({ text: text.slice(0, 80) }, 'posted to real Slack');
    return msg;
  }

  /** Console lever: post as "[PM]" so the poller counts it as an inbound change. */
  async pushInbound(text: string, user = 'pm'): Promise<SlackMessage> {
    const data = await this.api<{ ts: string }>('chat.postMessage', {
      channel: config.slack.channelId,
      text: `[PM] ${text}`,
    });
    this.counter += 1;
    return { id: this.counter, text, user, ts: data.ts };
  }

  /**
   * Inbound = human messages, plus bot messages prefixed "[PM]" (Console lever).
   * Ceil's own status posts are excluded.
   */
  async fetchUnread(): Promise<SlackMessage[]> {
    const params = new URLSearchParams({ channel: config.slack.channelId, oldest: this.lastTs, limit: '20' });
    const res = await fetch(`${config.slack.apiUrl}/conversations.history?${params}`, {
      headers: { Authorization: `Bearer ${config.slack.botToken}` },
    });
    const data = (await res.json()) as { ok: boolean; error?: string; messages?: SlackHistoryMessage[] };
    if (!data.ok) throw new Error(`Slack conversations.history failed: ${data.error}`);

    const inbound: SlackMessage[] = [];
    for (const m of data.messages ?? []) {
      if (Number(m.ts) <= Number(this.lastTs)) continue;
      if (m.subtype) continue; // joins, edits, etc.
      const text = m.text ?? '';
      const isPmLever = text.startsWith('[PM] ');
      if (m.bot_id && !isPmLever) continue; // Ceil's own posts
      this.counter += 1;
      const id = this.counter;
      this.idToTs.set(id, m.ts);
      inbound.push({ id, text: isPmLever ? text.slice(5) : text, user: m.user ?? 'pm', ts: m.ts });
    }
    return inbound;
  }

  async markRead(ids: number[]): Promise<void> {
    for (const id of ids) {
      const ts = this.idToTs.get(id);
      if (ts && Number(ts) > Number(this.lastTs)) this.lastTs = ts;
    }
  }
}
