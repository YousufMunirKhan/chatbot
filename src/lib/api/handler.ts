import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { authenticateApiKey, hasScope, type ApiScope } from '@/lib/api-keys';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { rateLimitDistributed } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { hasFeature } from '@/lib/entitlements';

/**
 * Shared wrapper for every public `/api/v1` route.
 *
 * Authentication, scope enforcement, rate limiting, error shaping and request
 * logging live here exactly once, so an endpoint is a query and a mapping —
 * and so no endpoint can accidentally ship without one of them.
 *
 * TENANT ISOLATION: `ctx.companyId` comes from the API key and nowhere else.
 * Handlers must filter every query by it and must never read a company id out
 * of the request.
 */

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'invalid_request'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'not_configured'
  | 'internal_error';

const STATUS_FOR: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  invalid_request: 400,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  not_configured: 503,
  internal_error: 500,
};

/** Throw from a handler to return a shaped error envelope. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  constructor(code: ApiErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status ?? STATUS_FOR[code];
  }
}

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
}

/** Success envelope. Every list endpoint returns `meta`; single reads omit it. */
export function apiData<T>(data: T, meta?: PaginationMeta, status = 200): NextResponse {
  return NextResponse.json(meta ? { data, meta } : { data }, { status });
}

/** Error envelope: `{ error: { code, message } }`. */
export function apiErrorResponse(code: ApiErrorCode, message: string, status?: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: status ?? STATUS_FOR[code] });
}

export const DEFAULT_PER_PAGE = 25;
export const MAX_PER_PAGE = 100;

export interface Pagination {
  page: number;
  perPage: number;
  /** Inclusive row range for PostgREST `.range()`. */
  from: number;
  to: number;
}

/** `?page=` / `?per_page=` → a safe, clamped range. Junk falls back to page 1. */
export function parsePagination(searchParams: URLSearchParams): Pagination {
  const rawPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const rawPer = Number.parseInt(searchParams.get('per_page') ?? String(DEFAULT_PER_PAGE), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const perPage = Number.isFinite(rawPer) && rawPer > 0 ? Math.min(rawPer, MAX_PER_PAGE) : DEFAULT_PER_PAGE;
  const from = (page - 1) * perPage;
  return { page, perPage, from, to: from + perPage - 1 };
}

export function paginationMeta(pagination: Pagination, total: number | null): PaginationMeta {
  return { page: pagination.page, per_page: pagination.perPage, total: total ?? 0 };
}

/** ISO-8601 filter value (`?since=`), rejected loudly rather than ignored. */
export function parseIsoDate(value: string | null, field: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError('invalid_request', `\`${field}\` must be an ISO-8601 date/time.`);
  }
  return date.toISOString();
}

export interface ApiContext {
  req: Request;
  companyId: string;
  apiKeyId: string;
  scopes: string[];
  params: Record<string, string>;
  searchParams: URLSearchParams;
  /** Parsed JSON body, or `{}` for an empty body. Throws 400 on malformed JSON. */
  json: () => Promise<unknown>;
}

/** Per-key budget. Generous for automation, low enough to bound server cost. */
export const API_RATE_LIMIT_PER_MINUTE = 120;
const RATE_WINDOW_MS = 60_000;

type RouteContext = { params?: Record<string, string> } | undefined;

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || null;
  return req.headers.get('x-real-ip');
}

async function logRequest(entry: {
  companyId: string;
  apiKeyId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip: string | null;
}): Promise<void> {
  try {
    await createSupabaseServiceClient().from('api_request_logs').insert({
      company_id: entry.companyId,
      api_key_id: entry.apiKeyId,
      method: entry.method,
      path: entry.path.slice(0, 500),
      status: entry.status,
      duration_ms: entry.durationMs,
      ip: entry.ip,
    });
  } catch (err) {
    // The log is an audit convenience — never fail a served request over it.
    logger.warn('API request log insert failed', {
      module: 'api/v1',
      companyId: entry.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Wrap a `/api/v1` handler.
 *
 * `scope` is the capability the key must hold. The returned function is a
 * Next.js route handler, so a route file is:
 *
 *   export const GET = withApiAuth('contacts:read', async (ctx) => …);
 */
export function withApiAuth(
  scope: ApiScope,
  handler: (ctx: ApiContext) => Promise<Response> | Response,
): (req: Request, routeContext?: RouteContext) => Promise<Response> {
  return async function handleApiRequest(req: Request, routeContext?: RouteContext): Promise<Response> {
    const started = Date.now();
    const url = new URL(req.url);

    const principal = await authenticateApiKey(req);
    if (!principal) {
      return apiErrorResponse(
        'unauthorized',
        'Missing or invalid API key. Send `Authorization: Bearer rvk_live_…`.',
      );
    }

    const finish = async (response: Response): Promise<Response> => {
      await logRequest({
        companyId: principal.companyId,
        apiKeyId: principal.apiKeyId,
        method: req.method,
        path: url.pathname,
        status: response.status,
        durationMs: Date.now() - started,
        ip: clientIp(req),
      });
      response.headers.set('X-RateLimit-Limit', String(API_RATE_LIMIT_PER_MINUTE));
      return response;
    };

    if (!hasScope(principal.scopes, scope)) {
      return finish(
        apiErrorResponse('forbidden', `This API key is missing the \`${scope}\` scope.`),
      );
    }

    // Closing the Developers page only stops new keys being minted; a key the
    // company already holds keeps working whatever its plan says. `hasFeature`
    // rather than `companyHasFeature` because the company comes from the key,
    // not from a session. Going through `finish` keeps the refusal in
    // `api_requests`, which is where a customer finds out why their integration
    // stopped.
    if (!(await hasFeature(principal.companyId, 'api_access'))) {
      return finish(
        apiErrorResponse(
          'forbidden',
          'Your plan does not include API access. See Billing to change your package.',
          402,
        ),
      );
    }

    const { ok } = await rateLimitDistributed(
      `api_v1:${principal.apiKeyId}`,
      API_RATE_LIMIT_PER_MINUTE,
      RATE_WINDOW_MS,
    );
    if (!ok) {
      const response = apiErrorResponse(
        'rate_limited',
        `Rate limit exceeded (${API_RATE_LIMIT_PER_MINUTE} requests per minute). Retry shortly.`,
      );
      response.headers.set('Retry-After', '60');
      return finish(response);
    }

    const ctx: ApiContext = {
      req,
      companyId: principal.companyId,
      apiKeyId: principal.apiKeyId,
      scopes: principal.scopes,
      params: routeContext?.params ?? {},
      searchParams: url.searchParams,
      json: async () => {
        const raw = await req.text();
        if (!raw.trim()) return {};
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          throw new ApiError('invalid_request', 'Request body must be valid JSON.');
        }
      },
    };

    try {
      return await finish(await handler(ctx));
    } catch (err) {
      if (err instanceof ApiError) {
        return finish(apiErrorResponse(err.code, err.message, err.status));
      }
      if (err instanceof ZodError) {
        const issue = err.issues[0];
        const where = issue?.path.join('.') || 'body';
        return finish(
          apiErrorResponse('invalid_request', `${where}: ${issue?.message ?? 'Invalid request.'}`),
        );
      }
      logger.error('Public API handler failed', {
        module: 'api/v1',
        companyId: principal.companyId,
        route: url.pathname,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return finish(
        apiErrorResponse('internal_error', 'Something went wrong handling this request.'),
      );
    }
  };
}

/** Turn a PostgREST error into a shaped 500 instead of an unhandled throw. */
export function assertNoDbError(error: { message: string } | null, what: string): void {
  if (!error) return;
  throw new ApiError('internal_error', `Could not load ${what}.`);
}
