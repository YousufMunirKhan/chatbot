import crypto from 'node:crypto';
import { logger } from '@/lib/logger';

/**
 * How an unconfigured signing secret is treated.
 *
 * Skipping verification is a development convenience — it lets someone replay a
 * sample payload with curl before any provider credentials exist. In production
 * it is a hole: an inbound webhook with no signature check accepts a forged
 * customer message from anyone who learns the URL, which then reaches the AI,
 * the inbox and the customer's own WhatsApp thread.
 *
 * So the rule is: no secret configured means *allow* in development and *deny*
 * in production, loudly.
 */
export function unverifiedIsAllowed(context: string): boolean {
  if (process.env.NODE_ENV === 'production') {
    logger.error('Rejecting an unsigned webhook: no signing secret is configured', { context });
    return false;
  }
  return true;
}

/** Constant-time compare that tolerates a length mismatch instead of throwing. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Verify an HMAC signature over the raw request body.
 *
 * `raw` must be the exact bytes the provider signed — parsing and re-serialising
 * the JSON changes whitespace and key order and breaks every signature.
 */
export function verifyHmac(params: {
  raw: string;
  signature: string | null;
  secret: string | null | undefined;
  algorithm?: 'sha1' | 'sha256';
  encoding?: 'hex' | 'base64';
  /** Prefix the provider puts in front of the digest, e.g. "sha256=". */
  prefix?: string;
  /** Named in the log line when verification is skipped or fails. */
  context: string;
}): boolean {
  const { raw, signature, secret, context } = params;
  if (!secret) return unverifiedIsAllowed(context);
  if (!signature) return false;
  const digest = crypto
    .createHmac(params.algorithm ?? 'sha256', secret)
    .update(raw)
    .digest(params.encoding ?? 'hex');
  return safeEqual(`${params.prefix ?? ''}${digest}`, signature);
}
