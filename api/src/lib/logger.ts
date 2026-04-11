/**
 * Structured logger — JSON output for production, human-readable for dev.
 * Each log line includes timestamp, level, message, and optional context.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const isDev = process.env.NODE_ENV !== 'production';
const minLevel = LOG_LEVELS[(process.env.LOG_LEVEL as LogLevel) || (isDev ? 'debug' : 'info')];

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, msg: string, context?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < minLevel) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...context,
  };

  if (isDev) {
    // Human-readable format for development
    const ctx = context ? ' ' + JSON.stringify(context) : '';
    const levelColor = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' }[level];
    const reset = '\x1b[0m';
    const stream = level === 'error' ? console.error : console.log;
    stream(`${levelColor}[${entry.timestamp}] ${level.toUpperCase().padEnd(5)}${reset} ${msg}${ctx}`);
  } else {
    // JSON for production (structured logging)
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(JSON.stringify(entry) + '\n');
  }
}

export const log = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
};
