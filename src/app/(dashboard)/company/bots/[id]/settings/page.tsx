import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BookOpen, Cable, Database, Globe2, LifeBuoy, MessageSquare, Settings } from 'lucide-react';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { BotForm } from '@/modules/company/components/bot-form';
import { PromptConfigForm } from '@/modules/company/components/prompt-config-form';
import { WidgetEmbedInstructions } from '@/modules/company/components/widget-embed-instructions';
import { updateBotAction } from '@/modules/company/actions';
import { getBot, getCurrentCompany } from '@/modules/company/data';
import { loadPromptConfig } from '@/modules/company/prompt';
import { env } from '@/lib/env';
import { RefreshDashboardShellOnce } from '@/components/refresh-dashboard-shell';

function assistantAudienceCopy(isInternalAssistant: boolean) {
  return isInternalAssistant
    ? {
        label: 'Staff assistant',
        badge: 'Your team only',
        description:
          'Answers your team’s questions about how your business works, looks things up in your shop system, and passes anything it cannot handle to a person.',
      }
    : {
        label: 'Website assistant',
        badge: 'On your website',
        description:
          'Talks to visitors on your website: answers questions, takes enquiries and bookings, and passes the chat to a person when it needs to.',
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

  const embed = `<script src="${env.NEXT_PUBLIC_WIDGET_URL}" data-bot-id="${bot.publicBotId}"></script>`;
  const isInternalAssistant = bot.assistantAudience === 'internal';
  const audienceCopy = assistantAudienceCopy(isInternalAssistant);
  const shortcuts = isInternalAssistant
    ? [
        { title: 'Ask the Help Desk', body: 'Open the chat your team uses.', href: '/company/help-desk?tab=ask', icon: MessageSquare },
        { title: 'Link your shop system', body: 'Set up the link so it can read your screens and prices.', href: '/company/help-desk?tab=connect', icon: Cable },
        { title: 'Check what it learned', body: 'Approve what it picked up before your team relies on it.', href: '/company/help-desk?tab=knowledge', icon: BookOpen },
        { title: 'Getting help to a person', body: 'Set up requests, alerts, and WhatsApp.', href: '/company/help-desk?tab=support', icon: LifeBuoy },
      ]
    : [
        { title: 'Website widget', body: 'Choose the colours, wording, and how it appears on your site.', href: '/company/widget', icon: Globe2 },
        { title: 'Your business details', body: 'Keep the answers it gives customers up to date.', href: '/company/business-data', icon: Database },
        { title: 'Channels', body: 'Add WhatsApp and the other places customers message you.', href: '/company/channels', icon: MessageSquare },
        { title: 'Assistant settings', body: 'Your website addresses, replies, and passing chats to a person.', href: `/company/bots/${bot.id}/settings`, icon: Settings },
      ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {searchParams?.created === '1' ? <RefreshDashboardShellOnce /> : null}
      <div className="space-y-2">
        <PageHeader backTo={{ href: '/company/bots', label: 'Assistants' }} title={bot.name} />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isInternalAssistant ? 'warning' : 'secondary'}>{audienceCopy.label}</Badge>
          <Badge variant="secondary">{audienceCopy.badge}</Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">{audienceCopy.description}</p>
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
        <summary className="cursor-pointer px-6 py-4 font-semibold">How it speaks to people</summary>
        <div className="space-y-6 border-t p-6">
          <div>
            <h2 className="text-base font-semibold">Tone and wording</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Optional. Most people leave this alone.
            </p>
          </div>
          <PromptConfigForm key={`${bot.id}:${bot.botType}`} botId={bot.id} botType={bot.botType} config={config} />
          {/*
            The raw assembled system prompt used to be dumped into a <pre> here —
            several hundred lines of model instructions in a shop owner's
            dashboard. It is a platform-operator diagnostic, not a customer
            surface, so it is gone from this panel entirely.
          */}
        </div>
      </details>

      {isInternalAssistant ? (
        <Card>
          <CardHeader>
            <CardTitle>Help Desk workspace</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              A staff assistant does not go on your website, so it has no website addresses or
              snippet. It works through the Help Desk instead, once your shop system is linked to it.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border p-3">
                <p className="font-medium text-foreground">1. Link it up</p>
                <p className="mt-1 text-xs">Set up the link between the Help Desk and your shop system.</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium text-foreground">2. Check what it learned</p>
                <p className="mt-1 text-xs">Approve the screens and steps it picked up from your system.</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium text-foreground">3. Put it to work</p>
                <p className="mt-1 text-xs">Your team asks questions and runs the tasks you have approved.</p>
              </div>
            </div>
            <Button asChild size="sm">
              <Link href="/company/help-desk">Open the Help Desk</Link>
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
