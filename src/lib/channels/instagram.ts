import { logger } from '@/lib/logger';

/**
 * Send an Instagram/Messenger reply via the Meta Graph send API using the page
 * access token (stored on the channel identity). Free-form text is allowed
 * inside the standard messaging window opened by the user's inbound message.
 */
export async function sendInstagramText(pageToken: string, recipientId: string, text: string): Promise<boolean> {
  if (!pageToken) return false;
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: 'RESPONSE',
        message: { text: text.slice(0, 1000) },
      }),
    });
    if (!res.ok) {
      logger.error('Instagram send failed', { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    logger.error('Instagram send threw', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
