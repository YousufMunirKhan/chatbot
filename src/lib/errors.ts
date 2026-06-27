import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { logger } from './logger';

/**
 * Error handling helpers (Module 1: "error handling helpers").
 *
 * Use `AppError` (and its subclasses) inside route handlers / services, then
 * wrap the handler body with `handleApiError` in the catch block so every API
 * route returns a consistent JSON shape: `{ error: { code, message } }`.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status = 400, code = 'bad_request', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'unauthorized');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'forbidden');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404, 'not_found');
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'rate_limited');
  }
}

export class PlanLimitError extends AppError {
  constructor(message = 'Plan limit reached') {
    super(message, 402, 'plan_limit_reached');
  }
}

/** Convert any thrown value into a safe JSON API response. */
export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: error.flatten(),
        },
      },
      { status: 422 },
    );
  }

  if (error instanceof AppError) {
    if (error.status >= 500) logger.error(error.message, { code: error.code });
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }

  logger.error('Unhandled error', { error: error instanceof Error ? error.message : String(error) });
  return NextResponse.json(
    { error: { code: 'internal_error', message: 'Something went wrong' } },
    { status: 500 },
  );
}
