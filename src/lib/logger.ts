/**
 * Minimal structured logger (Module 1: "logging helper").
 *
 * Emits JSON in production (easy to ship to a log drain) and pretty output in
 * development. Always attach `companyId` / `conversationId` where available so
 * logs remain tenant-isolated and traceable across the AI engine and jobs.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

type Context = Record<string, unknown> & {
  companyId?: string;
  conversationId?: string;
  module?: string;
};

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: Level = process.env.APP_ENV === 'development' ? 'debug' : 'info';

function shouldLog(level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

function emit(level: Level, message: string, context?: Context) {
  if (!shouldLog(level)) return;
  const entry = { level, message, time: new Date().toISOString(), ...context };
  const line =
    process.env.APP_ENV === 'development'
      ? `[${level.toUpperCase()}] ${message}${context ? ' ' + JSON.stringify(context) : ''}`
      : JSON.stringify(entry);

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, ctx?: Context) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: Context) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: Context) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: Context) => emit('error', msg, ctx),
  /** Bind a base context (e.g. a module name) to all subsequent logs. */
  child: (base: Context) => ({
    debug: (msg: string, ctx?: Context) => emit('debug', msg, { ...base, ...ctx }),
    info: (msg: string, ctx?: Context) => emit('info', msg, { ...base, ...ctx }),
    warn: (msg: string, ctx?: Context) => emit('warn', msg, { ...base, ...ctx }),
    error: (msg: string, ctx?: Context) => emit('error', msg, { ...base, ...ctx }),
  }),
};
