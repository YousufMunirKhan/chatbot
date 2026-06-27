import { z } from 'zod';
import { loadBotByPublicId, isOriginAllowed } from '@/lib/ai/engine';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { loadPublicQuickActions } from '@/lib/quick-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  publicBotId: z.string().min(1),
  context: z.string().optional(),
  pageUrl: z.string().optional(),
});

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
    headers: { ...headers, 'Content-Type': 'application/json' },
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
  if (bot.assistantAudience === 'internal') return json({ error: 'internal_assistant_not_available_on_widget' }, 403, headers);
  if (!isOriginAllowed(bot.domainAllowlist, origin)) return json({ error: 'domain_not_allowed' }, 403, headers);

  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('bots')
    .select('appearance_json')
    .eq('id', bot.id)
    .eq('company_id', bot.companyId)
    .maybeSingle();
  const appearance = (data?.appearance_json as Record<string, unknown> | null) ?? {};
  const quickActions = await loadPublicQuickActions({
    companyId: bot.companyId,
    botId: bot.id,
    capabilities: bot.capabilityFlags,
    context: parsed.data.context,
    pageUrl: parsed.data.pageUrl,
  });

  return json(
    {
      bot: {
        name: bot.name,
        title: (appearance.title as string) || bot.name || 'Website Assistant',
        welcomeMessage:
          (appearance.welcomeMessage as string) ||
          'Hi, I can help with services, pricing, appointments, orders, and support. What would you like to sort out today?',
        primaryColor: (appearance.primaryColor as string) || null,
        position: (appearance.position as string) || 'right',
        agentLabel: (appearance.agentLabel as string) || 'Team',
        agentAvatarUrl: (appearance.agentAvatarUrl as string) || null,
        launcherIcon: (appearance.launcherIcon as string) || 'chat',
        onlineLabel: (appearance.onlineLabel as string) || 'Team is replying - live',
        offlineLabel: (appearance.offlineLabel as string) || 'Replying soon',
        typingLabel: (appearance.typingLabel as string) || 'Team is typing',
        footerBranding:
          (appearance.footerBranding as string) ||
          'AI assistant may be inaccurate. We may use messages and contact details to respond to your enquiry.',
        proactiveMessage:
          (appearance.proactiveMessage as string) ||
          'Need help choosing the right option? I can guide you in under a minute.',
        autoOpen: Boolean(appearance.autoOpen),
        autoOpenOnce: appearance.autoOpenOnce !== false,
        autoOpenDelaySeconds: Number(appearance.autoOpenDelaySeconds ?? 3),
        launcherStyle: (appearance.launcherStyle as string) || 'circle',
        launcherSize: (appearance.launcherSize as string) || 'default',
        windowSize: (appearance.windowSize as string) || 'default',
        mobileMode: (appearance.mobileMode as string) || 'fullscreen',
        showOnMobile: appearance.showOnMobile !== false,
        showOnDesktop: appearance.showOnDesktop !== false,
        bottomOffset: Number(appearance.bottomOffset ?? 20),
        sideOffset: Number(appearance.sideOffset ?? 20),
        zIndex: Number(appearance.zIndex ?? 2147483000),
      },
      quickActions,
    },
    200,
    headers,
  );
}
