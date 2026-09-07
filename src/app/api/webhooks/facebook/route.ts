import { handleChannelWebhookGet, handleChannelWebhookPost } from '@/lib/channels/webhook-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Facebook Messenger + Page feed webhook.
 *
 * CHANNEL_DESCRIPTORS advertises `/api/webhooks/facebook`, and a static segment
 * takes precedence over `[channel]` in the Next router, so this file exists to
 * keep that exact path alive. All of the logic is the shared implementation —
 * this is an alias, not a second code path.
 *
 * GET verifies with META_VERIFY_TOKEN (or WHATSAPP_VERIFY_TOKEN); POST bodies
 * are signed with META_APP_SECRET.
 */
export async function GET(req: Request) {
  return handleChannelWebhookGet(req, 'facebook');
}

export async function POST(req: Request) {
  return handleChannelWebhookPost(req, 'facebook');
}
