import { getJson, postJson } from '../http';
import {
  ensureGoogleAccessToken,
  parseGoogleCredentials,
  persistGoogleCredentials,
} from '../google-oauth';
import { blocksToText } from '../types';
import type { ChannelAdapter, ChannelSendContext, InboundEvent } from '../types';

const YT = 'https://www.googleapis.com/youtube/v3';

/**
 * YouTube.
 *
 * YouTube has no comment webhook - PubSubHubbub only pushes new uploads. So the
 * conversational surface is polled: `pollYouTubeComments` walks each connected
 * channel's recent comment threads on a schedule and hands new top-level
 * comments to the same inbound pipeline. Replies go back through
 * `comments.insert`.
 *
 * `parse` still exists for the push endpoint so a new upload can start a flow.
 */
export const youtubeAdapter: ChannelAdapter = {
  key: 'youtube',
  label: 'YouTube',
  externalIdHint: 'YouTube channel id (starts with UC)',
  identityFromQuery: true,

  parse(payload, ctx): InboundEvent[] {
    // The poller pushes already-normalised events through this same shape.
    if (payload && typeof payload === 'object' && Array.isArray((payload as { events?: unknown }).events)) {
      return (payload as { events: InboundEvent[] }).events;
    }
    void ctx;
    return [];
  },

  async send(ctx, to, blocks): Promise<boolean> {
    const text = blocksToText(blocks);
    if (!text) return false;
    return replyToYouTubeComment(await usableToken(ctx), to, text);
  },

  async replyToComment(ctx, commentId, text) {
    return replyToYouTubeComment(await usableToken(ctx), commentId, text);
  },
};

/**
 * A Google access token good for this call.
 *
 * The stored credential is refreshed and written back when it has expired, so
 * a reply an hour after the channel was connected still lands.
 */
async function usableToken(ctx: ChannelSendContext): Promise<string | null> {
  if (!ctx.secret) return null;
  const creds = parseGoogleCredentials(ctx.secret);
  if (!creds) return null;
  const { accessToken, refreshed } = await ensureGoogleAccessToken(creds);
  if (refreshed && ctx.identityId) await persistGoogleCredentials(ctx.identityId, refreshed);
  return accessToken;
}

/** Reply in-thread to a comment. `token` is an OAuth access token. */
export async function replyToYouTubeComment(
  token: string | null,
  parentCommentId: string,
  text: string,
): Promise<boolean> {
  if (!token) return false;
  const res = await postJson(
    `${YT}/comments?part=snippet`,
    { snippet: { parentId: parentCommentId, textOriginal: text.slice(0, 9000) } },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res.ok;
}

export interface YouTubeCommentThread {
  commentId: string;
  videoId: string;
  authorChannelId: string;
  authorName: string;
  text: string;
  publishedAt: string;
}

/**
 * Read recent top-level comments across a channel's videos.
 *
 * `allThreadsRelatedToChannelId` returns every thread on the channel in one
 * call, newest first - one request per poll rather than one per video.
 */
export async function fetchYouTubeCommentThreads(
  token: string,
  channelId: string,
  max = 50,
): Promise<YouTubeCommentThread[]> {
  const url =
    `${YT}/commentThreads?part=snippet&allThreadsRelatedToChannelId=${encodeURIComponent(channelId)}` +
    `&maxResults=${Math.min(Math.max(max, 1), 100)}&order=time&textFormat=plainText`;
  const res = await getJson<{
    items?: Array<{
      snippet?: {
        videoId?: string;
        topLevelComment?: {
          id?: string;
          snippet?: {
            authorDisplayName?: string;
            authorChannelId?: { value?: string };
            textOriginal?: string;
            publishedAt?: string;
          };
        };
      };
    }>;
  }>(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok || !res.body?.items) return [];

  const out: YouTubeCommentThread[] = [];
  for (const item of res.body.items) {
    const top = item.snippet?.topLevelComment;
    const snippet = top?.snippet;
    const commentId = top?.id;
    const text = (snippet?.textOriginal ?? '').trim();
    if (!commentId || !text) continue;
    out.push({
      commentId,
      videoId: item.snippet?.videoId ?? '',
      authorChannelId: snippet?.authorChannelId?.value ?? commentId,
      authorName: snippet?.authorDisplayName ?? 'YouTube viewer',
      text,
      publishedAt: snippet?.publishedAt ?? new Date().toISOString(),
    });
  }
  return out;
}
