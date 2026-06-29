import { z } from 'zod';
import { loadBotByPublicId, isOriginAllowed } from '@/lib/ai/engine';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { loadPublicQuickActions } from '@/lib/quick-actions';
import { getActiveWebProactiveRules } from '@/modules/company/campaigns-data';

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
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' },
  });
}

function requestOrigin(reqOrigin: string | null, pageUrl?: string): string | null {
  if (reqOrigin) return reqOrigin;
  if (!pageUrl) return null;
  try {
    return new URL(pageUrl).origin;
  } catch {
    return null;
  }
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
  if (!isOriginAllowed(bot.domainAllowlist, requestOrigin(origin, parsed.data.pageUrl))) {
    return json({ error: 'domain_not_allowed' }, 403, headers);
  }

  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('bots')
    .select('appearance_json')
    .eq('id', bot.id)
    .eq('company_id', bot.companyId)
    .maybeSingle();
  const appearance = (data?.appearance_json as Record<string, unknown> | null) ?? {};
  const [quickActions, proactiveRules] = await Promise.all([
    loadPublicQuickActions({
      companyId: bot.companyId,
      botId: bot.id,
      capabilities: bot.capabilityFlags,
      context: parsed.data.context,
      pageUrl: parsed.data.pageUrl,
      audience: 'customer',
      settings: {
        enableDefaultPills: appearance.enableDefaultPills !== false,
        enableContextualPills: appearance.enableContextualPills !== false,
        enableConnectorGeneratedPills: appearance.enableConnectorGeneratedPills !== false,
      },
    }),
    getActiveWebProactiveRules(bot.companyId, bot.id),
  ]);

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
        avatarMode: (appearance.avatarMode as string) || 'initials',
        launcherIcon: (appearance.launcherIcon as string) || 'chat',
        launcherImageUrl: (appearance.launcherImageUrl as string) || null,
        launcherLabel: (appearance.launcherLabel as string) || null,
        launcherDotMode: (appearance.launcherDotMode as string) || 'unread',
        launcherDotColor: (appearance.launcherDotColor as string) || '#ef4444',
        headerTextColor: (appearance.headerTextColor as string) || '#ffffff',
        headerStyle: (appearance.headerStyle as string) || 'solid',
        widgetVersion: Number(appearance.widgetVersion ?? 0),
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
        autoOpenDesktop:
          appearance.autoOpenDesktop != null ? Boolean(appearance.autoOpenDesktop) : Boolean(appearance.autoOpen),
        autoOpenMobile:
          appearance.autoOpenMobile != null ? Boolean(appearance.autoOpenMobile) : Boolean(appearance.autoOpen),
        autoOpenDelayDesktopSeconds: Number(
          appearance.autoOpenDelayDesktopSeconds ?? appearance.autoOpenDelaySeconds ?? 2,
        ),
        autoOpenDelayMobileSeconds: Number(appearance.autoOpenDelayMobileSeconds ?? 60),
        launcherGlow: Boolean(appearance.launcherGlow),
        launcherGlowMobileOnly: appearance.launcherGlowMobileOnly !== false,
        launcherStyle: (appearance.launcherStyle as string) || 'pill',
        launcherSize: (appearance.launcherSize as string) || 'default',
        windowSize: (appearance.windowSize as string) || 'default',
        mobileMode: (appearance.mobileMode as string) || 'fullscreen',
        showOnMobile: appearance.showOnMobile !== false,
        showOnDesktop: appearance.showOnDesktop !== false,
        bottomOffset: Number(appearance.bottomOffset ?? 20),
        sideOffset: Number(appearance.sideOffset ?? 20),
        zIndex: Number(appearance.zIndex ?? 2147483000),
        // CSAT: post-conversation 1–5 rating. Off unless the company enables it.
        csatEnabled: Boolean(appearance.csatEnabled),
        csatPrompt: (appearance.csatPrompt as string) || 'How would you rate this conversation?',
        csatThanks: (appearance.csatThanks as string) || 'Thanks for your feedback!',
        csatCommentEnabled: appearance.csatCommentEnabled !== false,
      },
      quickActions,
      proactiveRules,
    },
    200,
    headers,
  );
}
