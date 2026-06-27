import { createHash } from 'crypto';
import { createSupabaseServiceClient } from '@/lib/db/server';

export type AppErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface LogAppErrorInput {
  companyId?: string | null;
  userId?: string | null;
  botId?: string | null;
  conversationId?: string | null;
  source: string;
  severity?: AppErrorSeverity;
  message: string;
  stack?: string | null;
  route?: string | null;
  statusCode?: number | null;
  metadata?: Record<string, unknown> | null;
}

const SECRET_KEY_RE = /(token|secret|password|authorization|cookie|api[_-]?key|service[_-]?role|access[_-]?token)/i;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function cleanScalar(value: unknown): unknown {
  if (typeof value === 'string') return truncate(value, 500);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  return String(value).slice(0, 500);
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== 'object') return cleanScalar(value);
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 60)) {
    out[key] = SECRET_KEY_RE.test(key) ? '[redacted]' : sanitize(raw, depth + 1);
  }
  return out;
}

function fingerprintFor(input: LogAppErrorInput): string {
  return createHash('sha256')
    .update([input.source, input.route ?? '', input.message].join('|'))
    .digest('hex')
    .slice(0, 24);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(sanitize(error));
}

export function errorStack(error: unknown): string | null {
  return error instanceof Error && error.stack ? truncate(error.stack, 6000) : null;
}

export async function logAppError(input: LogAppErrorInput): Promise<void> {
  try {
    const sb = createSupabaseServiceClient();
    await sb.from('application_error_logs').insert({
      company_id: input.companyId ?? null,
      user_id: input.userId ?? null,
      bot_id: input.botId ?? null,
      conversation_id: input.conversationId ?? null,
      source: truncate(input.source || 'server', 80),
      severity: input.severity ?? 'error',
      message: truncate(input.message || 'Unknown error', 2000),
      stack: input.stack ? truncate(input.stack, 6000) : null,
      route: input.route ? truncate(input.route, 300) : null,
      status_code: input.statusCode ?? null,
      fingerprint: fingerprintFor(input),
      metadata_json: (sanitize(input.metadata ?? {}) as Record<string, unknown>) ?? {},
    });
  } catch {
    // Non-fatal by design: error logging must never break the original request.
  }
}
