import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ingestAttachment } from '@/lib/attachments/store';
import { assertRole, getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  handleApiError,
} from '@/lib/errors';
import { logger } from '@/lib/logger';
import { rateLimitDistributed } from '@/lib/ratelimit';
import { markFirstResponse } from '@/lib/sla';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The agent half of attachments: sending a customer a receipt, a screenshot of
 * the setting they need, a shipping label.
 *
 * This is a route rather than a server action because a file is not a field.
 * The composer's action posts text through `sendAgentReplyAction` and is
 * finished before the upload starts, so a slow 10 MB PDF never holds up a
 * two-line reply, and a rejected file never costs the agent the words they
 * typed.
 *
 * The company id comes from the session and never from the request, so the
 * conversation id in the body can only ever resolve inside the caller's own
 * tenant — the same rule `/api/company/copilot` follows.
 */

const bodySchema = z.object({ conversationId: z.string().uuid() });

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) throw new UnauthorizedError();
    assertRole(user, [ROLES.COMPANY_ADMIN, ROLES.AGENT]);
    if (!user.companyId) throw new ForbiddenError('This account is not attached to a company.');
    const companyId = user.companyId;

    // Per agent: one person clearing a backlog of screenshots should not lock
    // their colleagues out of the composer.
    const limit = await rateLimitDistributed(`agent-upload:${user.userId}`, 20, 60_000);
    if (!limit.ok) throw new RateLimitError('Too many uploads. Wait a moment.');

    const form = await req.formData();
    const { conversationId } = bodySchema.parse({ conversationId: form.get('conversationId') });
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError('No file was sent.', 400, 'attachment_missing');

    const sb = createSupabaseServiceClient();
    const { data: convo } = await sb
      .from('conversations')
      .select('id,status,channel')
      .eq('company_id', companyId)
      .eq('id', conversationId)
      .maybeSingle();
    if (!convo) throw new NotFoundError('Conversation not found.');
    const row = convo as { status?: string; channel?: string };
    const wasHumanActive = row.status === 'human_active';

    // Sending a file is a person stepping in, so it takes the conversation over
    // exactly as typing a reply does. This mirrors `sendAgentReplyAction` in
    // src/modules/company/inbox-actions.ts deliberately: an agent who attaches a
    // photo and says nothing must not have the AI answer over the top of them.
    //
    // The notice goes in FIRST because it has to read before the file it
    // introduces, and is taken back out if the upload is then refused — a
    // customer told an agent joined, followed by nothing at all, is worse than
    // no notice.
    let joinNoticeId: string | null = null;
    if (!wasHumanActive) {
      const { data: notice } = await sb
        .from('messages')
        .insert({
          company_id: companyId,
          conversation_id: conversationId,
          sender_type: 'system',
          sender_id: user.userId,
          content_text: 'A human agent joined the chat.',
          content_type: 'system',
        })
        .select('id')
        .maybeSingle();
      joinNoticeId = (notice?.id as string | undefined) ?? null;
    }

    let stored;
    try {
      stored = await ingestAttachment({
        companyId,
        conversationId,
        file,
        uploader: { type: 'agent', userId: user.userId },
        // The conversation's own channel, not a default: an inbox filtered by
        // channel would otherwise lose this message out of a WhatsApp thread.
        channel: row.channel ?? 'web_chat',
        // An agent's own file is not something the inbox should badge as unread.
        bumpUnread: false,
      });
    } catch (err) {
      if (joinNoticeId) {
        await sb.from('messages').delete().eq('company_id', companyId).eq('id', joinNoticeId);
      }
      throw err;
    }

    const { error: updErr } = await sb
      .from('conversations')
      .update({
        ai_enabled: false,
        status: 'human_active',
        assigned_agent_id: user.userId,
        first_agent_reply_at: wasHumanActive ? undefined : new Date().toISOString(),
        unread_count: 0,
        last_message_at: new Date().toISOString(),
      })
      .eq('company_id', companyId)
      .eq('id', conversationId);
    if (updErr) {
      // The file is sent and the customer can see it; only the takeover failed.
      // Say so in the log rather than telling the agent their upload failed.
      logger.error('Conversation takeover after agent attachment failed', {
        companyId,
        conversationId,
        error: updErr.message,
      });
    }

    // Stops the SLA first-response clock. Harmless when no policy is running.
    await markFirstResponse({ companyId, conversationId });

    revalidatePath('/company/inbox');
    revalidatePath(`/company/inbox/${conversationId}`);

    return NextResponse.json({
      messageId: stored.messageId,
      attachment: {
        id: stored.id,
        name: stored.name,
        mimeType: stored.mimeType,
        size: stored.size,
        kind: stored.kind,
        url: stored.url,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
