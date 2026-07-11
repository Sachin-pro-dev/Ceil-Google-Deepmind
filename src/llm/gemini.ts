/**
 * GeminiClient — the single surface for direct Gemini reasoning calls (used by the
 * Looper, Manager, and Planning). It calls the verified generateContent REST
 * endpoint (proven working against the temp account) using JSON mode +
 * zod validation for structured output. Two modes:
 *   - "mock": returns the caller-supplied deterministic value (no key, no quota).
 *   - "real": live Gemini call.
 * Every call site supplies a `mock` fallback so the whole system runs offline.
 */
import type { z } from 'zod';
import { childLogger } from '../logger';

const log = childLogger('gemini');

export interface GeminiConfig {
  mode: 'mock' | 'real';
  apiKey: string;
  baseUrl: string;
}

/** Strip ```json fences a model may wrap JSON in. */
function stripFences(s: string): string {
  return s
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

export class GeminiClient {
  constructor(private cfg: GeminiConfig) {}

  /** Generate free-form text. `mock` is returned verbatim in mock mode. */
  async generateText(opts: { prompt: string; model: string; mock: string; temperature?: number }): Promise<string> {
    if (this.cfg.mode === 'mock') {
      log.info({ model: opts.model, mode: 'mock' }, 'generateText');
      return opts.mock;
    }
    const text = await this.call(opts.model, opts.prompt, false, opts.temperature);
    return text.trim();
  }

  /** Generate JSON validated against a zod schema. `mock` is returned in mock mode. */
  async generateJSON<T>(opts: {
    prompt: string;
    model: string;
    schema: z.ZodType<T>;
    mock: T;
    temperature?: number;
  }): Promise<T> {
    if (this.cfg.mode === 'mock') {
      log.info({ model: opts.model, mode: 'mock' }, 'generateJSON');
      return opts.schema.parse(opts.mock);
    }
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const prompt =
        attempt === 1 ? opts.prompt : `${opts.prompt}\n\nReturn ONLY valid JSON. No prose, no markdown fences.`;
      const raw = await this.call(opts.model, prompt, true, opts.temperature);
      try {
        return opts.schema.parse(JSON.parse(stripFences(raw)));
      } catch (err) {
        lastErr = err;
        log.warn({ attempt, model: opts.model }, 'JSON parse/validate failed');
      }
    }
    throw new Error(`GeminiClient.generateJSON failed validation: ${String(lastErr)}`);
  }

  /** Low-level generateContent REST call. Returns the concatenated text output. */
  private async call(model: string, prompt: string, json: boolean, temperature = 0.7): Promise<string> {
    if (!this.cfg.apiKey) throw new Error('GEMINI_API_KEY is not set; cannot make a real Gemini call.');
    const url = `${this.cfg.baseUrl}/models/${model}:generateContent`;
    const body: Record<string, unknown> = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: json ? { temperature, responseMimeType: 'application/json' } : { temperature },
    };
    log.info({ model, json }, 'gemini call');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.cfg.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Gemini ${model} HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) throw new Error(`Gemini ${model} returned no text: ${JSON.stringify(data).slice(0, 200)}`);
    return text;
  }
}
