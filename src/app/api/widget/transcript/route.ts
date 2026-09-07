import { z } from 'zod';
import { isOriginAllowed, loadBotByPublicId } from '@/lib/ai/engine';
import { createSupabaseServiceClient } from '@/lib/db/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Transcript restore for the website widget.
 *
 * The widget keeps a conversation id in localStorage but had nothing to fetch
 * with it, so a refresh wiped the visible conversation. One customer filled the
 * same enquiry form twice and created two conversations because of that — they
 * had no way to tell they had already been served.
 *
 * /api/chat/messages exists but deliberately returns only agent and system
 * messages: it is the poll that backs up the realtime stream, and replaying the
 * visitor's own words there would duplicate every bubble already on screen.
 * Restoring the window needs the opposite — everything, in order, once.
 *
 * Ownership is the same anonymous-but-scoped rule the rest of the widget uses:
 * an unguessable conversation UUID that must belong to this bot's company AND
 * carry this visitor's id.
 */

const querySchema = z.object({
  publicBotId: z.string().min(1),
  conversationId: z.string().uuid(),
  visitorId: z.string().min(1).max(100),
});

// Enough to make the window look like the visitor left it without shipping a
// year of history to a phone. Taken from the END of the conversation, because
// the last exchange is the one that has to still be there after a refresh.
const MAX_MESSAGES = 60;

function cors(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' },
  });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin')) });
}

export async function GET(req: Request) {
  const origin = req.headers.get('origin');
  const headers = cors(origin);
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return json({ error: 'invalid_request' }, 400, headers);

  const bot = await loadBotByPublicId(parsed.data.publicBotId);
  if (!bot) return json({ error: 'bot_not_found' }, 404, headers);
  if (bot.assistantAudience === 'internal') {
    return json({ error: 'internal_assistant_not_available_on_widget' }, 403, headers);
  }
  if (!isOriginAllowed(bot.domainAllowlist, origin)) {
    return json({ error: 'domain_not_allowed' }, 403, headers);
  }

  const sb = createSupabaseServiceClient();
  const { data: convo } = await sb
    .from('conversations')
    .select('id,visitor_id,status,ai_enabled,language')
    .eq('company_id', bot.companyId)
    .eq('id', parsed.data.conversationId)
    .maybeSingle();
  if (!convo) return json({ error: 'conversation_not_found' }, 404, headers);
  const c = convo as Record<string, unknown>;
  if (c.visitor_id !== parsed.data.visitorId) {
    return json({ error: 'conversation_not_yours' }, 403, headers);
  }

  // Newest-first with a limit, then reversed, so the tail of a long
  // conversation survives instead of the beginning of it.
  const { data: rows } = await sb
    .from('messages')
    .select('id,sender_type,content_text,created_at')
    .eq('company_id', bot.companyId)
    .eq('conversation_id', parsed.data.conversationId)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES);

  const messages = ((rows ?? []) as Array<Record<string, unknown>>)
    .slice()
    .reverse()
    .filter((m) => String(m.content_text ?? '').trim().length > 0)
    .map((m) => ({
      id: m.id as string,
      senderType: m.sender_type as string,
      text: m.content_text as string,
      createdAt: m.created_at as string,
    }));

  // Whether this conversation already has captured contact details, so a
  // reloaded widget does not put the pre-chat form in front of somebody who
  // filled it in ten seconds ago. localStorage alone cannot answer this — the
  // reload that loses the transcript is often the one that lost the flag too.
  const { count: leadCount } = await sb
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', bot.companyId)
    .eq('conversation_id', parsed.data.conversationId);

  return json(
    {
      conversationId: parsed.data.conversationId,
      status: (c.status as string) ?? 'ai_active',
      humanActive: c.status === 'human_active' || c.ai_enabled === false,
      language: (c.language as string | null) ?? null,
      contactCaptured: (leadCount ?? 0) > 0,
      lastMessageAt: messages.length ? messages[messages.length - 1]?.createdAt ?? null : null,
      messages,
    },
    200,
    headers,
  );
}
