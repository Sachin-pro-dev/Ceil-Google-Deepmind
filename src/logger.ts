/**
 * Structured logging via pino (Principle 6 — a real logger, not console.log).
 * Secrets (API keys, auth headers) are redacted so they never reach a log line.
 */
import { pino } from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'apiKey',
      'geminiApiKey',
      'GEMINI_API_KEY',
      'authorization',
      'headers.authorization',
      '*.apiKey',
      '*.geminiApiKey',
    ],
    censor: '[REDACTED]',
  },
  transport:
    config.env === 'local'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});

/** Returns a child logger tagged with the module name, for traceable logs. */
export const childLogger = (mod: string) => logger.child({ mod });
