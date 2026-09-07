import { z } from 'zod';
import { getOrCreateConversation, isOriginAllowed, loadBotByPublicId } from '@/lib/ai/engine';
import { ingestAttachment, listConversationAttachments } from '@/lib/attachments/store';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { rateLimitDistributed } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The visitor half of attachments: a customer sending a photo of the thing that
 * is broken.
 *
 * POST takes one file and posts it into the conversation as a message. GET
 * returns every attachment already in that conversation, freshly signed —
 * which the widget needs after a reload, because the URLs it had are dead by
 * then. Both live on this one route because a signed URL is only ever minted
 * for a file this endpoint stored, and keeping the pair together makes it
 * obvious that they enforce identical ownership.
 *
 * Ownership is the same anonymous-but-scoped rule the rest of the widget uses,
 * and it is checked three times over: the bot must exist and be a customer-
 * facing one, the request's `Origin` must be on that bot's domain allowlist,
 * and the conversation must belong to the bot's company AND carry this
 * visitor's id. A conversation uuid alone is not enough to write into a chat.
 */

const uploadSchema = z.object({
  publicBotId: z.string().min(1),
  visitorId: z.string().min(1).max(100),
  conversationId: z.string().uuid().optional(),
});

const listSchema = z.object({
  publicBotId: z.string().min(1),
  conversationId: z.string().uuid(),
  visitorId: z.string().min(1).max(100),
});

function cors(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' },
  });
}

/**
 * The widget reads `error` as a flat string — it has no error envelope and no
 * build step to give it one — so `handleApiError`'s nested shape is flattened
 * here rather than teaching every widget call site about `error.message`.
 */
function fail(err: unknown, headers: Record<string, string>) {
  if (err instanceof AppError) return json({ error: err.message, code: err.code }, err.status, headers);
  logger.error('Widget attachment request failed', {
    error: err instanceof Error ? err.message : String(err),
    route: '/api/widget/upload',
  });
  return json({ error: 'The file could not be sent. Try again.' }, 500, headers);
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin')) });
}

/**
 * Resolve the bot and confirm this origin may talk to it. Shared by both verbs
 * so a GET can never be looser than the POST that created the files.
 */
async function resolveBot(publicBotId: string, origin: string | null) {
  const bot = await loadBotByPublicId(publicBotId);
  if (!bot) throw new AppError('This assistant is not available.', 404, 'bot_not_found');
  if (bot.assistantAudience === 'internal') {
    throw new AppError(
      'This assistant is not available on the website widget.',
      403,
      'internal_assistant_not_available_on_widget',
    );
  }
  if (!isOriginAllowed(bot.domainAllowlist, origin)) {
    throw new AppError('This website is not enabled for the assistant yet.', 403, 'domain_not_allowed');
  }
  return bot;
}

/** A conversation belongs to this visitor, or it does not exist as far as they know. */
async function assertVisitorOwnsConversation(params: {
  companyId: string;
  conversationId: string;
  visitorId: string;
}): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('conversations')
    .select('id,visitor_id')
    .eq('company_id', params.companyId)
    .eq('id', params.conversationId)
    .maybeSingle();
  if (!data) throw new AppError('That conversation no longer exists.', 404, 'conversation_not_found');
  if ((data as { visitor_id?: string }).visitor_id !== params.visitorId) {
    throw new AppError('That conversation belongs to someone else.', 403, 'conversation_not_yours');
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const headers = cors(origin);
  try {
    const form = await req.formData();
    const parsed = uploadSchema.safeParse({
      publicBotId: form.get('publicBotId') ?? undefined,
      visitorId: form.get('visitorId') ?? undefined,
      conversationId: form.get('conversationId') || undefined,
    });
    if (!parsed.success) throw new AppError('Invalid request.', 400, 'invalid_request');

    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError('No file was sent.', 400, 'attachment_missing');

    const bot = await resolveBot(parsed.data.publicBotId, origin);

    // Per visitor rather than per company: one person spamming photos must not
    // stop another customer of the same business from sending one.
    const limit = await rateLimitDistributed(`widget-upload:${parsed.data.visitorId}`, 10, 60_000);
    if (!limit.ok) {
      throw new AppError('Too many uploads. Wait a moment and try again.', 429, 'rate_limited');
    }

    if (parsed.data.conversationId) {
      await assertVisitorOwnsConversation({
        companyId: bot.companyId,
        conversationId: parsed.data.conversationId,
        visitorId: parsed.data.visitorId,
      });
    }

    // A visitor can open the chat and lead with a photo before typing anything,
    // so the conversation may not exist yet. Reusing the engine's own creation
    // path means such a chat is indistinguishable from one started with text —
    // the widget stores the returned id and /api/chat picks it straight up.
    const conversation = await getOrCreateConversation({
      companyId: bot.companyId,
      botId: bot.id,
      conversationId: parsed.data.conversationId,
      visitorId: parsed.data.visitorId,
      language: bot.languageDefault,
      channel: 'web_chat',
    });

    const stored = await ingestAttachment({
      companyId: bot.companyId,
      conversationId: conversation.id,
      file,
      uploader: { type: 'visitor', visitorId: parsed.data.visitorId },
      channel: 'web_chat',
      // Always, unlike a typed message — /api/chat only raises the badge when a
      // human is already on the conversation, because the assistant answers the
      // rest. Nothing answers a photo: the model is never shown one, so an
      // attachment that did not raise the badge would sit unseen until somebody
      // happened to open the chat.
      bumpUnread: true,
    });

    return json(
      {
        conversationId: conversation.id,
        messageId: stored.messageId,
        attachment: {
          id: stored.id,
          name: stored.name,
          mimeType: stored.mimeType,
          size: stored.size,
          kind: stored.kind,
          url: stored.url,
        },
        createdAt: stored.createdAt,
      },
      200,
      headers,
    );
  } catch (err) {
    return fail(err, headers);
  }
}

export async function GET(req: Request) {
  const origin = req.headers.get('origin');
  const headers = cors(origin);
  try {
    const url = new URL(req.url);
    const parsed = listSchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) throw new AppError('Invalid request.', 400, 'invalid_request');

    const bot = await resolveBot(parsed.data.publicBotId, origin);
    await assertVisitorOwnsConversation({
      companyId: bot.companyId,
      conversationId: parsed.data.conversationId,
      visitorId: parsed.data.visitorId,
    });

    const attachments = await listConversationAttachments({
      companyId: bot.companyId,
      conversationId: parsed.data.conversationId,
    });

    return json({ attachments }, 200, headers);
  } catch (err) {
    return fail(err, headers);
  }
}
