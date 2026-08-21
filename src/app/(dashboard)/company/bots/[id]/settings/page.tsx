import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BookOpen, Cable, Database, Globe2, LifeBuoy, MessageSquare, Settings } from 'lucide-react';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BotForm } from '@/modules/company/components/bot-form';
import { PromptConfigForm } from '@/modules/company/components/prompt-config-form';
import { WidgetEmbedInstructions } from '@/modules/company/components/widget-embed-instructions';
import { updateBotAction } from '@/modules/company/actions';
import { getBot, getCurrentCompany } from '@/modules/company/data';
import { loadPromptConfig } from '@/modules/company/prompt';
import { assembleSystemPrompt } from '@/lib/ai/prompts/assemble';
import { env } from '@/lib/env';
import { RefreshDashboardShellOnce } from '@/components/refresh-dashboard-shell';

function assistantAudienceCopy(isInternalAssistant: boolean) {
  return isInternalAssistant
    ? {
        label: 'Internal Help Desk',
        badge: 'Staff only',
        description: 'Used inside the company account for staff questions, software guides, connector actions, and escalation.',
      }
    : {
        label: 'Customer Website Assistant',
        badge: 'Public widget',
        description: 'Used on the customer website for visitor chat, leads, bookings, support handoff, and website widget setup.',
      };
}

export default async function BotSettingsPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { created?: string };
}) {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const bot = await getBot(params.id);
  if (!bot) notFound();

  const [company, config] = await Promise.all([getCurrentCompany(), loadPromptConfig(bot.id)]);
  const assembledPrompt = assembleSystemPrompt({
    botType: bot.botType,
    assistantAudience: bot.assistantAudience,
    language: bot.languageDefault,
    businessName: company.name,
    capabilities: bot.capabilityFlags,
    config,
  });

  const embed = `<script src="${env.NEXT_PUBLIC_WIDGET_URL}" data-bot-id="${bot.publicBotId}"></script>`;
  const isInternalAssistant = bot.assistantAudience === 'internal';
  const audienceCopy = assistantAudienceCopy(isInternalAssistant);
  const shortcuts = isInternalAssistant
    ? [
        { title: 'Ask Help Desk', body: 'Open the single internal chat used by staff.', href: '/company/help-desk?tab=ask', icon: MessageSquare },
        { title: 'Connect Software', body: 'Create keys, download SDKs, sync routes, and verify setup.', href: '/company/help-desk?tab=connect', icon: Cable },
        { title: 'Review Knowledge', body: 'Approve synced screen docs before staff rely on them.', href: '/company/help-desk?tab=knowledge', icon: BookOpen },
        { title: 'Support Flow', body: 'Handle tickets, notifications, WhatsApp, and escalation.', href: '/company/help-desk?tab=support', icon: LifeBuoy },
      ]
    : [
        { title: 'Website Widget', body: 'Design launcher, labels, colours, and public chat behaviour.', href: '/company/widget', icon: Globe2 },
        { title: 'Business Data', body: 'Manage the public knowledge used for customer answers.', href: '/company/business-data', icon: Database },
        { title: 'Channels', body: 'Connect WhatsApp and other customer messaging channels.', href: '/company/channels', icon: MessageSquare },
        { title: 'Bot Settings', body: 'Control website domains, snippets, AI replies, and handoff.', href: `/company/bots/${bot.id}/settings`, icon: Settings },
      ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {searchParams?.created === '1' ? <RefreshDashboardShellOnce /> : null}
      <div>
        <Link href="/company/bots" className="text-sm text-muted-foreground hover:underline">
          <span className="dir-arrow" aria-hidden="true">←</span> Assistants
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{bot.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant={isInternalAssistant ? 'warning' : 'secondary'}>{audienceCopy.label}</Badge>
          <Badge variant="secondary">{audienceCopy.badge}</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{audienceCopy.description}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {shortcuts.map((shortcut) => {
          const Icon = shortcut.icon;
          return (
            <Link key={shortcut.title} href={shortcut.href} className="rounded-md border bg-card p-4 hover:bg-muted/40">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="h-4 w-4 text-primary" />
                {shortcut.title}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{shortcut.body}</p>
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <BotForm
            key={`${bot.id}:${bot.assistantAudience}`}
            action={updateBotAction}
            bot={bot}
            companyName={company.name}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>

      <details className="rounded-md border bg-card">
        <summary className="cursor-pointer px-6 py-4 font-semibold">Advanced prompt settings</summary>
        <div className="space-y-6 border-t p-6">
          <div>
            <h2 className="text-base font-semibold">Prompt &amp; behavior</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Optional tone and instruction controls. Most customers can leave this as-is.
            </p>
          </div>
          <PromptConfigForm key={`${bot.id}:${bot.botType}`} botId={bot.id} botType={bot.botType} config={config} />
          <div>
            <h2 className="text-base font-semibold">Generated system prompt</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Technical preview generated from audience, capabilities, tone, and safety rules.
            </p>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
              {assembledPrompt}
            </pre>
          </div>
        </div>
      </details>

      {isInternalAssistant ? (
        <Card>
          <CardHeader>
            <CardTitle>Help Desk workspace</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Internal Help Desk assistants do not use public website domains or embed snippets.
              They work through the Help Desk workspace: create a connector, copy the hdk_ key
              into the customer system, sync screen docs, approve knowledge, and enable safe actions.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border p-3">
                <p className="font-medium text-foreground">1. Connect</p>
                <p className="mt-1 text-xs">Download Android, .NET, Node, or Laravel connector packages.</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium text-foreground">2. Review</p>
                <p className="mt-1 text-xs">Approve generated screen docs and route explanations.</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium text-foreground">3. Use</p>
                <p className="mt-1 text-xs">Staff ask the Help Desk and run approved local events.</p>
              </div>
            </div>
            <Button asChild size="sm">
              <Link href="/company/help-desk">Open Help Desk workspace</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Website widget embed</CardTitle>
          </CardHeader>
          <CardContent>
            <WidgetEmbedInstructions
              embed={embed}
              domainAllowlist={bot.domainAllowlist}
              settingsHref={`/company/bots/${bot.id}/settings`}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
