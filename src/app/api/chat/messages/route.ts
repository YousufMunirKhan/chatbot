import { createSupabaseServiceClient } from '@/lib/db/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Widget history endpoint: fetch agent/system messages for a conversation.
 * Live human replies are delivered by /api/chat/realtime (no polling).
 * Scoped by conversationId (unguessable UUID) + matching visitorId.
 */
function cors(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin')) });
}

export async function GET(req: Request) {
  const headers = { ...cors(req.headers.get('origin')), 'Content-Type': 'application/json' };
  const url = new URL(req.url);
  const conversationId = url.searchParams.get('conversationId');
  const visitorId = url.searchParams.get('visitorId');
  const after = url.searchParams.get('after');

  if (!conversationId || !visitorId) {
    return new Response(JSON.stringify({ error: 'missing_params' }), { status: 400, headers });
  }

  const sb = createSupabaseServiceClient();
  const { data: convo } = await sb
    .from('conversations')
    .select('id, visitor_id, status, ai_enabled')
    .eq('id', conversationId)
    .maybeSingle();

  if (!convo || convo.visitor_id !== visitorId) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers });
  }

  let q = sb
    .from('messages')
    .select('id, sender_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['agent', 'system'])
    .order('created_at', { ascending: true });
  if (after) q = q.gt('created_at', after);

  const { data: messages } = await q;

  return new Response(
    JSON.stringify({
      humanActive: convo.status === 'human_active' || !convo.ai_enabled,
      messages: messages ?? [],
    }),
    { status: 200, headers },
  );
}
