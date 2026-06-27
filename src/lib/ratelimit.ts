import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';

/**
 * Rate limiter (Module 23, Issue #16).
 *
 * Primary backend is Postgres (`rate_limit_hit` RPC) so limits hold ACROSS
 * serverless instances — the previous in-memory Map reset on every cold start
 * and barely limited anything on Vercel. If the DB call fails we fall back to a
 * per-instance in-memory window so a transient DB hiccup never blocks chat.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

function inMemory(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }
  b.count++;
  if (b.count > limit) return { ok: false, remaining: 0 };
  return { ok: true, remaining: limit - b.count };
}

/** Synchronous in-memory limiter (kept for non-critical/local callers). */
export function rateLimit(key: string, limit = 20, windowMs = 60_000): { ok: boolean; remaining: number } {
  return inMemory(key, limit, windowMs);
}

/**
 * Distributed limiter. Returns `{ ok }` — `ok: false` means over the limit.
 * Falls back to the in-memory window if the RPC is unavailable.
 */
export async function rateLimitDistributed(
  key: string,
  limit = 20,
  windowMs = 60_000,
): Promise<{ ok: boolean }> {
  try {
    const sb = createSupabaseServiceClient();
    const { data, error } = await sb.rpc('rate_limit_hit', {
      p_key: key,
      p_limit: limit,
      p_window_ms: windowMs,
    });
    if (error) throw error;
    return { ok: data === true };
  } catch (err) {
    logger.warn('Distributed rate limit fell back to in-memory', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: inMemory(key, limit, windowMs).ok };
  }
}
