import { createSupabaseServiceClient } from '@/lib/db/server';
import { getVisitorRealtimeProvider } from '@/lib/realtime/server';
import { isOriginAllowed, loadBotByPublicId } from '@/lib/ai/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const origin = req.headers.get('origin');
  const headers = cors(origin);
  const url = new URL(req.url);
  const publicBotId = url.searchParams.get('publicBotId');
  const conversationId = url.searchParams.get('conversationId');
  const visitorId = url.searchParams.get('visitorId');

  if (!publicBotId || !conversationId || !visitorId) {
    return new Response(JSON.stringify({ error: 'missing_params' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const bot = await loadBotByPublicId(publicBotId);
  if (!bot) {
    return new Response(JSON.stringify({ error: 'bot_not_found' }), {
      status: 404,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
  if (bot.assistantAudience === 'internal') {
    return new Response(JSON.stringify({ error: 'internal_assistant_not_available_on_widget' }), {
      status: 403,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
  if (!isOriginAllowed(bot.domainAllowlist, origin)) {
    return new Response(JSON.stringify({ error: 'domain_not_allowed' }), {
      status: 403,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const sb = createSupabaseServiceClient();
  const { data: convo } = await sb
    .from('conversations')
    .select('id, company_id, bot_id, visitor_id')
    .eq('id', conversationId)
    .eq('company_id', bot.companyId)
    .eq('bot_id', bot.id)
    .maybeSingle();

  if (!convo || convo.visitor_id !== visitorId) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      send({ type: 'connected', conversationId });
      const sub = await getVisitorRealtimeProvider().subscribeToConversation({
        conversationId,
        onEvent: send,
        onError: (error) => send({ type: 'error', value: error instanceof Error ? error.message : String(error) }),
      });

      heartbeat = setInterval(() => send({ type: 'ping', time: new Date().toISOString() }), 25_000);

      req.signal.addEventListener('abort', async () => {
        if (heartbeat) clearInterval(heartbeat);
        await sub.close();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      ...headers,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
