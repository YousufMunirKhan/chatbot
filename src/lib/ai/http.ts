/**
 * Resilient HTTP for AI/provider calls (Issue #13).
 *
 * Wraps `fetch` with an AbortController timeout and exponential backoff on
 * transient failures (HTTP 429 / 5xx / network errors). Every provider call —
 * chat, embeddings, rerank, tool loops — goes through this so a slow or flaky
 * upstream can never hang an SSE stream indefinitely.
 */
export interface RetryOptions {
  /** Per-attempt timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Number of RETRIES after the first attempt. Default 2 (3 attempts total). */
  retries?: number;
  /** Base backoff in ms (doubled each retry, with jitter). Default 400ms. */
  backoffMs?: number;
  /** Caller-supplied abort signal (e.g. client disconnected). */
  signal?: AbortSignal;
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function backoffDelay(attempt: number, base: number): number {
  const exp = base * 2 ** attempt;
  // Deterministic jitter (no Math.random — keeps behavior reproducible in tests):
  const jitter = (attempt * 37) % 100;
  return exp + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch + timeout + retry. Retries only idempotent-safe transient failures.
 * Throws the last error if all attempts fail.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: RetryOptions = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const retries = opts.retries ?? 2;
  const backoffMs = opts.backoffMs ?? 400;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener('abort', onParentAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        // Honor Retry-After when present, else exponential backoff.
        const retryAfter = Number(res.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : backoffDelay(attempt, backoffMs);
        await sleep(delay);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      // Parent (client) aborted — do not retry.
      if (opts.signal?.aborted) throw err;
      if (attempt < retries) {
        await sleep(backoffDelay(attempt, backoffMs));
        continue;
      }
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onParentAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Request failed after retries');
}
