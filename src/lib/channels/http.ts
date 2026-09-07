import { logger } from '@/lib/logger';

/** Outbound provider calls must never hang a webhook handler. */
const DEFAULT_TIMEOUT_MS = 8000;

export interface HttpResult<T = unknown> {
  ok: boolean;
  status: number;
  body: T | null;
  error?: string;
}

/** POST JSON with a hard timeout, returning a parsed body instead of throwing. */
export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  init: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<HttpResult<T>> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    body: JSON.stringify(body),
    timeoutMs: init.timeoutMs,
  });
}

export async function getJson<T = unknown>(
  url: string,
  init: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<HttpResult<T>> {
  return request<T>(url, { method: 'GET', headers: init.headers, timeoutMs: init.timeoutMs });
}

export async function request<T = unknown>(
  url: string,
  init: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  },
): Promise<HttpResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    let parsed: T | null = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as T;
      } catch {
        parsed = null;
      }
    }
    if (!res.ok) {
      logger.warn('Channel provider call failed', { url: safeUrl(url), status: res.status, body: text.slice(0, 400) });
      return { ok: false, status: res.status, body: parsed, error: text.slice(0, 400) };
    }
    return { ok: true, status: res.status, body: parsed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Channel provider call threw', { url: safeUrl(url), error: message });
    return { ok: false, status: 0, body: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Strip bot tokens and access_token query params before they reach the logs. */
export function safeUrl(url: string): string {
  return url
    .replace(/\/bot[0-9]+:[A-Za-z0-9_-]+/g, '/bot***')
    .replace(/access_token=[^&]+/g, 'access_token=***');
}
