import { decryptSecret } from '@/lib/crypto';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { fetchYouTubeCommentThreads } from '../adapters/youtube';
import { accessTokenForIdentity } from '../google-oauth';
import { handleInboundEvents } from '../handler';
import type { InboundEvent } from '../types';
import type { PollResult } from './gmail';

const MAX_IDENTITIES = 25;
const MAX_THREADS_PER_IDENTITY = 50;

interface IdentityRow {
  id: string;
  company_id: string;
  external_id: string;
  secret_encrypted: string | null;
}

/**
 * Poll every connected YouTube channel for new top-level comments.
 *
 * YouTube has no comment webhook (PubSubHubbub only pushes uploads), so this is
 * the conversational surface. Re-seeing an old comment is safe and cheap: the
 * handler claims each one in `channel_comment_events` behind a unique index, so
 * a comment is answered exactly once no matter how often it is polled.
 */
export async function pollYouTubeIdentities(): Promise<PollResult> {
  const result: PollResult = { identities: 0, events: 0, handled: 0, errors: 0 };
  const sb = createSupabaseServiceClient();

  const { data, error } = await sb
    .from('channel_identities')
    .select('id,company_id,external_id,secret_encrypted')
    .eq('channel', 'youtube')
    .eq('is_active', true)
    .limit(MAX_IDENTITIES);
  if (error) {
    logger.error('YouTube poller could not list identities', { error: error.message });
    return { ...result, errors: 1 };
  }

  for (const row of (data ?? []) as IdentityRow[]) {
    result.identities += 1;
    try {
      // Google access tokens last an hour. Refresh (and persist) rather than
      // letting the connection quietly stop working after the first hour.
      const token = await accessTokenForIdentity({
        identityId: row.id,
        secretEncrypted: row.secret_encrypted,
        decrypt: decryptSecret,
      });
      if (!token) {
        logger.warn('YouTube channel has no usable access token — reconnect it', {
          externalId: row.external_id,
        });
        continue;
      }

      const threads = await fetchYouTubeCommentThreads(token, row.external_id, MAX_THREADS_PER_IDENTITY);
      const events: InboundEvent[] = threads.map((t) => ({
        externalId: row.external_id,
        from: t.authorChannelId,
        fromName: t.authorName,
        text: t.text,
        messageId: t.commentId,
        kind: 'comment',
        commentId: t.commentId,
        postId: t.videoId || undefined,
      }));
      if (events.length === 0) continue;

      result.events += events.length;
      const outcome = await handleInboundEvents('youtube', events);
      result.handled += outcome.handled;
    } catch (err) {
      result.errors += 1;
      // One channel's API failure must not abort the whole run.
      logger.error('YouTube poll failed for a channel', {
        externalId: row.external_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}
