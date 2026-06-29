import { logger } from '@/lib/logger';

/** Extract a bare email address from a "Name <a@b.com>" or raw string. */
export function extractEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Best-effort outbound email reply. Posts to a generic HTTP email API when
 * configured (EMAIL_API_URL + EMAIL_API_KEY, e.g. a transactional provider).
 * When unconfigured the AI answer is still saved to the conversation so an agent
 * can send it from the inbox — so inbound email always works, reply is additive.
 */
export async function sendChannelEmail(params: {
  to: string;
  from: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  const url = process.env.EMAIL_API_URL;
  const key = process.env.EMAIL_API_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ to: params.to, from: params.from, subject: params.subject, text: params.text }),
    });
    return res.ok;
  } catch (err) {
    logger.error('Outbound email reply failed', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
