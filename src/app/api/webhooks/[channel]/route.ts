import { handleChannelWebhookGet, handleChannelWebhookPost } from '@/lib/channels/webhook-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generic channel webhook: `/api/webhooks/<channel>`.
 *
 * Serves telegram, viber, line, facebook, tiktok and youtube. WhatsApp,
 * Instagram and email keep their dedicated routes — a static segment always
 * wins over this dynamic one in the Next router, so they are untouched.
 * Anything else 404s.
 *
 * Channels that do not identify the receiving account in the payload
 * (Telegram, Viber, TikTok, YouTube) carry it as `?id=<external id>`.
 */
export async function GET(req: Request, { params }: { params: { channel: string } }) {
  return handleChannelWebhookGet(req, params.channel);
}

export async function POST(req: Request, { params }: { params: { channel: string } }) {
  return handleChannelWebhookPost(req, params.channel);
}
