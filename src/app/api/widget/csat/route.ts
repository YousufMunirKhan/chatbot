import { z } from 'zod';
import { isOriginAllowed, loadBotByPublicId } from '@/lib/ai/engine';
import { createSupabaseServiceClient } from '@/lib/db/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Customer Satisfaction (CSAT) capture for the website widget.
 * Stores a 1–5 rating + optional comment against a conversation the visitor
 * actually owns. Mirrors the CORS / bot-resolution / origin guards used by the
 * other public widget endpoints (see /api/widget/actions/submit).
 */
const bodySchema = z.object({
  publicBotId: z.string().min(1),
  visitorId: z.string().min(1).max(100),
  conversationId: z.string().uuid(),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

function cors(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const headers = cors(origin);
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid_request' }, 400, headers);
  }

  const bot = await loadBotByPublicId(body.publicBotId);
  if (!bot) return json({ error: 'bot_not_found' }, 404, headers);
  if (bot.assistantAudience === 'internal') return json({ error: 'internal_assistant_not_available_on_widget' }, 403, headers);
  if (!isOriginAllowed(bot.domainAllowlist, origin)) return json({ error: 'domain_not_allowed' }, 403, headers);

  const sb = createSupabaseServiceClient();

  // The visitor may only rate a conversation that belongs to this bot's company
  // and was started by this same visitor id (anonymous-but-scoped ownership).
  const { data: convo } = await sb
    .from('conversations')
    .select('id,company_id,bot_id,visitor_id,channel')
    .eq('company_id', bot.companyId)
    .eq('id', body.conversationId)
    .maybeSingle();
  if (!convo) return json({ error: 'conversation_not_found' }, 404, headers);
  const c = convo as Record<string, unknown>;
  if (c.visitor_id && c.visitor_id !== body.visitorId) {
    return json({ error: 'conversation_not_yours' }, 403, headers);
  }

  const nowIso = new Date().toISOString();
  const channel = (c.channel as string) || 'web_chat';
  const comment = body.comment && body.comment.length ? body.comment : null;

  const { error: upsertError } = await sb.from('conversation_ratings').upsert(
    {
      company_id: bot.companyId,
      conversation_id: body.conversationId,
      bot_id: bot.id,
      visitor_id: body.visitorId,
      channel,
      rating: body.rating,
      comment,
      updated_at: nowIso,
    },
    { onConflict: 'conversation_id' },
  );
  if (upsertError) return json({ error: 'rating_failed' }, 500, headers);

  await sb
    .from('conversations')
    .update({ csat_rating: body.rating, csat_comment: comment, csat_rated_at: nowIso })
    .eq('company_id', bot.companyId)
    .eq('id', body.conversationId);

  // CSAT loop: a low score (1–2) flags the conversation into the Quality Room as
  // "needs review", turning the rating into a self-improvement signal. Best-effort.
  if (body.rating <= 2) {
    try {
      const { data: msgs } = await sb
        .from('messages')
        .select('sender_type,content_text,id,created_at')
        .eq('company_id', bot.companyId)
        .eq('conversation_id', body.conversationId)
        .order('created_at', { ascending: false })
        .limit(12);
      const rows = (msgs ?? []) as Array<Record<string, unknown>>;
      const lastVisitor = rows.find((m) => m.sender_type === 'visitor');
      const lastAi = rows.find((m) => m.sender_type === 'ai' || m.sender_type === 'agent');
      await sb.from('answer_quality_logs').insert({
        company_id: bot.companyId,
        bot_id: bot.id,
        conversation_id: body.conversationId,
        question: (lastVisitor?.content_text as string) || 'Low customer satisfaction rating',
        answer: (lastAi?.content_text as string) || '',
        failure_reason: 'low_csat',
        auto_audit_status: 'needs_review',
        auto_audit_label: 'low_csat',
        auto_audit_reason: `Customer rated this conversation ${body.rating}/5${comment ? `: "${comment}"` : ''}.`,
        metadata_json: { source: 'csat', rating: body.rating },
      });
    } catch {
      /* never let quality logging break the rating */
    }
  }

  return json({ ok: true }, 200, headers);
}
