import Link from 'next/link';
import {
  AlertCircle,
  Bell,
  BookOpen,
  Bot,
  Cable,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Download,
  Inbox,
  LifeBuoy,
  MessageSquare,
  PlugZap,
  RefreshCw,
  Settings,
  ShieldCheck,
  Terminal,
  Workflow,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { env } from '@/lib/env';
import { formatDate } from '@/lib/format';
import { companyLabel } from '@/lib/labels';
import { getReplyAllowanceUsage, type ReplyAllowanceUsage } from '@/lib/billing';
import { getHelpdeskConnectorWorkspace } from '@/modules/company/helpdesk-data';
import {
  requestConnectorResyncAction,
  setConnectorActionEnabledAction,
  testConnectorAction,
} from '@/modules/company/helpdesk-actions';
import {
  HelpdeskConnectorForm,
  QueueConnectorEventForm,
} from '@/modules/company/components/helpdesk-connector-form';
import { HelpdeskInternalChat } from '@/modules/company/components/helpdesk-internal-chat';
import { HelpdeskChatSettingsForm } from '@/modules/company/components/helpdesk-chat-settings-form';
import { HelpdeskDocumentReview } from '@/modules/company/components/helpdesk-document-review';
import { HelpdeskIssueReportForm } from '@/modules/company/components/helpdesk-issue-report-form';
import { TicketAutomationTestButton } from '@/modules/company/components/ticket-automation-test-button';
import { getCompanyId, listBots } from '@/modules/company/data';
import { listWebhookEndpoints, type WebhookEndpointRow } from '@/modules/company/webhooks-data';

// One name per concept: platform names now come from the shared label map
// rather than a private if-ladder that only knew three of the seven platforms.
function platformLabel(platform: string) {
  return companyLabel('connectorPlatform', platform);
}

function statusVariant(status: string): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (['active', 'approved', 'completed'].includes(status)) return 'success';
  if (['draft', 'queued', 'running'].includes(status)) return 'warning';
  if (['failed', 'rejected', 'revoked'].includes(status)) return 'destructive';
  return 'secondary';
}

const helpDeskTabs = [
  { key: 'overview', label: 'Overview', hint: 'Status and next steps', icon: ClipboardCheck },
  { key: 'ask', label: 'Ask', hint: 'The chat your team uses', icon: MessageSquare },
  { key: 'connect', label: 'Connect your software', hint: 'Link it to your shop system', icon: PlugZap },
  { key: 'knowledge', label: 'What it learned', hint: 'Approve before your team relies on it', icon: BookOpen },
  { key: 'actions', label: 'What it can do', hint: 'Turn things on and try them', icon: ShieldCheck },
  { key: 'support', label: 'Support', hint: 'Requests and WhatsApp', icon: LifeBuoy },
  { key: 'settings', label: 'Settings', hint: 'Where the chat appears', icon: Settings },
  { key: 'logs', label: 'History', hint: 'What has happened', icon: Terminal },
] as const;

type HelpDeskTab = (typeof helpDeskTabs)[number]['key'];

function normalizeTab(value: string | undefined): HelpDeskTab {
  return helpDeskTabs.some((tab) => tab.key === value) ? (value as HelpDeskTab) : 'overview';
}

function formatNumber(value: number | null): string {
  return value == null ? 'Unlimited' : value.toLocaleString();
}

function HelpDeskTabs({ active }: { active: HelpDeskTab }) {
  return (
    <div className="rounded-lg border bg-card p-2">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {helpDeskTabs.map((tab) => {
          const Icon = tab.icon;
          const selected = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={`/company/help-desk?tab=${tab.key}`}
              className={[
                'rounded-md border px-3 py-2 text-start transition-colors',
                selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
              ].join(' ')}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="h-4 w-4" />
                {tab.label}
              </span>
              <span className={selected ? 'mt-1 block text-xs text-primary-foreground/80' : 'mt-1 block text-xs text-muted-foreground'}>
                {tab.hint}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function ApiEndpoints() {
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  const endpoints = [
    ['Status', `GET ${baseUrl}/api/helpdesk/connectors/status`],
    ['Sync docs/actions', `POST ${baseUrl}/api/helpdesk/connectors/sync`],
    ['Poll events', `GET ${baseUrl}/api/helpdesk/connectors/events`],
    ['Send event result', `POST ${baseUrl}/api/helpdesk/connectors/events`],
  ];

  return (
    <div className="grid gap-2">
      {endpoints.map(([label, value]) => (
        <div key={label} className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <pre className="mt-1 overflow-auto text-xs">{value}</pre>
        </div>
      ))}
    </div>
  );
}

function WhatIsChecked() {
  const checks = [
    {
      title: 'Chat visibility',
      body: 'The chat checks enabled/hidden mode, current route, optional route targeting, and blocked routes. Staff role is for audit/action safety, not opening chat.',
    },
    {
      title: 'Preview',
      body: 'Preview reads the local manifest only. If only a few POS screens appear, the connector only sent those screens.',
    },
    {
      title: 'Audit',
      body: 'Audit checks missing route IDs, duplicate docs/actions, missing handlers, unsafe write actions, dangerous actions, and possible secrets.',
    },
    {
      title: 'Sync',
      body: 'Sync sends documents/actions as drafts. It does not upload product, order, customer, invoice, or database tables.',
    },
    {
      title: 'Route test',
      body: 'Route test calls the local callback. Passing means routeId is wired to the app router/form; failing means add it in the app details file.',
    },
    {
      title: 'Action test',
      body: 'Action test queues a sandbox event. The installed connector must poll or receive it, run the local handler, and post the result.',
    },
  ];

  // Route IDs, manifests, local handlers and sandbox events. Real, useful, and
  // addressed to a developer — so it says so, and stays collapsed by default.
  return (
    <Card>
      <CardHeader>
        <CardTitle>For your developer: what each check does</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Hand this to whoever is installing the connector. You do not need to read it.
        </p>
      </CardHeader>
      <CardContent>
        <details>
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
            Show the technical checks
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {checks.map((check) => (
              <div key={check.title} className="rounded-md border p-3">
                <p className="text-sm font-semibold">{check.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{check.body}</p>
              </div>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function ManualSetupGuide() {
  const files = [
    ['Android', 'HelpdeskAndroidAppDetails.kt', 'Add buildNavigation(...), buildActions(...), and buildManifest(...).'],
    ['.NET', 'HelpdeskDotnetAppDetails.cs', 'Add forms/screens, command route IDs, and service methods.'],
    ['Web/Node', 'HelpdeskWebAppDetails.js', 'Add admin pages, route URLs, and backend service handlers.'],
    ['Laravel', 'HelpdeskLaravelStarter.php', 'Replace sample ProductService/ReportService and route URLs.'],
  ];
  const manualSteps = [
    'Create or choose a connector and copy the hdk_ token.',
    'Open the platform details file listed below.',
    'Add every screen/page/form the staff assistant should know.',
    'Give each screen a stable routeId such as inventory.products.',
    'Map each routeId to the real app route, form opener, command, or URL.',
    'Add only actions that have real local handlers.',
    'Run Preview, Audit, Test route, then Sync.',
    'Approve generated draft docs and enable safe actions in this dashboard.',
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] [&>*]:min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>For your developer: setup steps</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm">
            {manualSteps.map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>For your developer: where to add screens and actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {files.map(([platform, file, purpose]) => (
            <div key={platform} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{platform}</p>
                <code className="rounded bg-muted px-2 py-1 text-xs">{file}</code>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{purpose}</p>
            </div>
          ))}
          <Alert tone="warning" className="px-3 py-2 text-xs leading-5">
            If your POS only shows seven screens, that means only seven screens were included in the manifest. Add more screens in the details file, then run Sync again.
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}

function DeliveryExplanation() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery model: WebSocket is optional</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Cable className="h-4 w-4 text-primary" />
            WebSocket
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Used when the gateway is available. It is faster, but not required for normal users.
          </p>
        </div>
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <RefreshCw className="h-4 w-4 text-primary" />
            Polling fallback
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            If WebSocket is unavailable, the connector safely checks the server every interval and still receives events.
          </p>
        </div>
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <AlertCircle className="h-4 w-4 text-primary" />
            What users should do
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Run the starter normally. Seeing fallback polling is okay. Fix only real errors like invalid token, bad Base URL, or missing handlers.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function DeveloperPackages() {
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  const packages = [
    {
      label: 'Android SDK',
      href: '/api/helpdesk/connectors/download/android',
      body: 'Kotlin client, POS action examples, docs sync, event polling, and resync handling.',
    },
    {
      label: '.NET SDK',
      href: '/api/helpdesk/connectors/download/dotnet',
      body: 'Console worker, POS action manifest, local handler examples, and environment setup.',
    },
    {
      label: 'Web SDK',
      href: '/api/helpdesk/connectors/download/web',
      body: 'Browser/admin UI helpers plus a backend JavaScript connector client.',
    },
    {
      label: 'Node starter',
      href: '/api/helpdesk/connectors/download/node',
      body: 'Plug-and-play Node worker with preview, audit, sync, polling, and sample services.',
    },
    {
      label: 'Laravel starter',
      href: '/api/helpdesk/connectors/download/laravel',
      body: 'PHP/Laravel service with manifest, audit, sync, polling, route test, and sample services.',
    },
    {
      label: 'React UI',
      href: '/api/helpdesk/connectors/download/react',
      body: 'Staff Help Desk chat component guide and default UI helper for React/Next admin apps.',
    },
    {
      label: 'Vue UI',
      href: '/api/helpdesk/connectors/download/vue',
      body: 'Staff Help Desk chat component guide and default UI helper for Vue/Nuxt admin apps.',
    },
    {
      label: 'Full web stack',
      href: '/api/helpdesk/connectors/download/fullstack',
      body: 'Everything for web, Node, Laravel, React, and Vue in one advanced package.',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Developer packages</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Give developers a token, this base URL, and the SDK package for their platform.
        </p>
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Base URL</p>
          <pre className="mt-1 overflow-auto text-xs">{baseUrl}</pre>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {packages.map((pkg) => (
            <div key={pkg.href} className="rounded-md border p-3">
              <p className="font-medium">{pkg.label}</p>
              <p className="mt-1 min-h-10 text-xs text-muted-foreground">{pkg.body}</p>
              <Button asChild size="sm" className="mt-3 gap-2">
                <Link href={pkg.href}>
                  <Download className="h-4 w-4" />
                  Download
                </Link>
              </Button>
            </div>
          ))}
        </div>
        {/*
          This link opens a raw JSON schema. That is a perfectly good thing to
          hand a developer and a baffling thing to put in front of a business
          owner, so it now sits behind a disclosure that says who it is for.
        */}
        <details className="rounded-md border bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm font-medium">For your developer</summary>
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              The exact format the Help Desk expects, as JSON. Your developer will know what to do
              with it.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/api/helpdesk/connectors/schema">Open the action format (JSON)</Link>
            </Button>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function ConnectorResyncButton({ connectorId }: { connectorId: string }) {
  return (
    <form action={requestConnectorResyncAction}>
      <input type="hidden" name="connectorId" value={connectorId} />
      <Button type="submit" size="sm" variant="outline" className="gap-2">
        <RefreshCw className="h-4 w-4" />
        Resync
      </Button>
    </form>
  );
}

function ConnectorTestButton({ connectorId }: { connectorId: string }) {
  return (
    <form action={testConnectorAction}>
      <input type="hidden" name="connectorId" value={connectorId} />
      <Button type="submit" size="sm" variant="ghost" className="gap-2">
        Test
      </Button>
    </form>
  );
}

function latencyVariant(ms: number): 'success' | 'warning' | 'destructive' {
  if (ms < 1500) return 'success';
  if (ms < 5000) return 'warning';
  return 'destructive';
}

type HelpdeskWorkspace = Awaited<ReturnType<typeof getHelpdeskConnectorWorkspace>>;
type ConnectorHealthAlert = {
  id: string;
  name: string;
  platform: string;
  state: string;
  message: string;
  lastError: string | null;
};

function minutesSince(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.max(1, Math.round(ms / 60000));
}

function connectorHealthAlerts(connectors: HelpdeskWorkspace['connectors']): ConnectorHealthAlert[] {
  return connectors
    .map((connector) => {
      const lastSeenMinutes = minutesSince(connector.lastSeenAt);
      const stale = lastSeenMinutes == null || lastSeenMinutes >= 10;
      const state = connector.connectionState ?? 'unknown';
      const unhealthy = connector.status !== 'active' || connector.lastError || state === 'offline' || state === 'degraded' || stale;
      if (!unhealthy) return null;
      const age = lastSeenMinutes == null ? 'never connected' : `offline for ${lastSeenMinutes}m`;
      return {
        id: connector.id,
        name: connector.name,
        platform: platformLabel(connector.platform),
        state,
        lastError: connector.lastError,
        message: `${platformLabel(connector.platform)} connector ${age}.`,
      } satisfies ConnectorHealthAlert;
    })
    .filter((alert): alert is ConnectorHealthAlert => alert != null);
}

function HelpDeskOverview({
  workspace,
  replyUsage,
  assistantHref,
  assistantLabel,
  draftCount,
  enabledActionCount,
  onlineCount,
}: {
  workspace: HelpdeskWorkspace;
  replyUsage: ReplyAllowanceUsage;
  assistantHref: string;
  assistantLabel: string;
  draftCount: number;
  enabledActionCount: number;
  onlineCount: number;
}) {
  const connected = workspace.connectors.length > 0;
  const needsReview = draftCount > 0;
  const ready = connected && !needsReview && enabledActionCount > 0;
  const steps = [
    { done: connected, label: 'Connect software', href: '/company/help-desk?tab=connect' },
    { done: !needsReview && connected, label: 'Approve knowledge', href: '/company/help-desk?tab=knowledge' },
    { done: enabledActionCount > 0, label: 'Enable safe actions', href: '/company/help-desk?tab=actions' },
    { done: ready, label: 'Ask Help Desk', href: '/company/help-desk?tab=ask' },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] [&>*]:min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>Help Desk status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Replies remaining</p>
              <p className="mt-1 text-2xl font-semibold">{formatNumber(replyUsage.remaining)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatNumber(replyUsage.used)} / {formatNumber(replyUsage.totalAvailable)} used
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Connected systems</p>
              <p className="mt-1 text-2xl font-semibold">{workspace.connectors.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">{onlineCount} online now</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Knowledge to review</p>
              <p className="mt-1 text-2xl font-semibold">{draftCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">Approve before staff rely on it</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Enabled actions</p>
              <p className="mt-1 text-2xl font-semibold">{enabledActionCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">Reports, stock, search, updates</p>
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold">{ready ? 'Help Desk is ready for staff' : 'Finish the setup path'}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  One internal assistant answers staff questions, opens known screens, and runs approved local actions through connectors.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href="/company/help-desk?tab=ask">Ask Help Desk</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/company/help-desk?tab=connect">Connect software</Link>
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            {steps.map((step, index) => (
              <Link key={step.label} href={step.href} className="rounded-md border p-3 hover:bg-muted/40">
                <div className="flex items-center gap-2">
                  <span className={step.done ? 'grid h-6 w-6 place-items-center rounded-full bg-success text-xs font-semibold text-background' : 'grid h-6 w-6 place-items-center rounded-full bg-muted text-xs font-semibold'}>
                    {step.done ? 'OK' : index + 1}
                  </span>
                  <span className="text-sm font-medium">{step.label}</span>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assistant setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 font-semibold">
              <Bot className="h-4 w-4 text-primary" />
              Internal Help Desk bot
            </div>
            <p className="mt-1 text-muted-foreground">
              Settings here are staff-only. Website widget, domains, and embed snippets stay with customer bots.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-3">
              <Link href={assistantHref}>{assistantLabel}</Link>
            </Button>
          </div>
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 font-semibold">
              <LifeBuoy className="h-4 w-4 text-primary" />
              When staff need help
            </div>
            <p className="mt-1 text-muted-foreground">
              Set up what happens when the assistant cannot solve something: who gets told, and how.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-3">
              <Link href="/company/help-desk?tab=support">Open support options</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function HowConnectorsWork() {
  const steps = [
    'Download the package for your software.',
    'Your developer installs it and pastes in your key.',
    'It sends over your screens and the tasks it can run.',
    'You check what it sent and approve it.',
    'You choose which tasks it is allowed to run.',
    'Your team starts asking the Help Desk.',
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>How the link to your shop system works</CardTitle>
        {/*
          Rescued from a component that was written, never rendered, and about to
          be deleted — it held the only plain-English definition of "connector"
          anywhere in the product. Everything else assumed the reader already
          knew, which for a shop owner is exactly the wrong assumption.
        */}
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          A connector is what lets the Help Desk read your software&rsquo;s screens and run approved
          actions inside it. Your developer sets it up once, and then your team can just ask.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-6">
        {steps.map((step, index) => (
          <div key={step} className="rounded-md border p-3">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {index + 1}
            </span>
            <p className="mt-3 text-sm font-medium">{step}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ActionsSection({ workspace }: { workspace: HelpdeskWorkspace }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What it is allowed to do</CardTitle>
        <p className="text-sm text-muted-foreground">
          Nothing here happens unless you switch it on. The work runs inside your own software, not on our servers.
        </p>
      </CardHeader>
      <CardContent>
        {workspace.actions.length === 0 ? (
          // Module 3 — actions only exist after a connector syncs its manifest.
          <div className="space-y-3">
            <p className="max-w-2xl text-sm text-muted-foreground">
              No actions registered yet. Actions arrive when a connector syncs its manifest — standard ones
              include search product, check stock, and daily sales report. Until then the assistant can only
              answer questions, not do things.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/company/help-desk?tab=connect">Open connector setup</Link>
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Connector</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Fields</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Test</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspace.actions.map((action) => (
                <TableRow key={action.id}>
                  <TableCell>
                    <div className="font-mono text-sm">{action.name}</div>
                    <div className="text-xs text-muted-foreground">{action.description}</div>
                    {action.needsConfirmation ? (
                      <Badge variant="warning" className="mt-1">Needs confirmation</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{action.connectorName}</TableCell>
                  <TableCell>
                    <Badge variant={action.risk === 'high' ? 'destructive' : action.risk === 'medium' ? 'warning' : 'secondary'}>
                      {companyLabel('actionRisk', action.risk)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    Required: {action.requiredFields.join(', ') || 'none'}
                  </TableCell>
                  <TableCell>
                    <form action={setConnectorActionEnabledAction} className="flex items-center gap-2">
                      <input type="hidden" name="actionId" value={action.id} />
                      <label className="flex items-center gap-1 text-xs">
                        <input name="enabled" type="checkbox" defaultChecked={action.isEnabled} className="h-4 w-4" />
                        Enabled
                      </label>
                      {action.actionType === 'read' || action.actionType === 'report' ? (
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            name="confirmationRequired"
                            type="checkbox"
                            defaultChecked={action.needsConfirmation}
                            className="h-4 w-4"
                          />
                          Confirm
                        </label>
                      ) : (
                        <>
                          <input type="hidden" name="confirmationRequired" value="on" />
                          <span className="text-xs text-muted-foreground">Confirm always</span>
                        </>
                      )}
                      <Button type="submit" size="sm" variant="outline">Save</Button>
                    </form>
                  </TableCell>
                  <TableCell>
                    {action.isEnabled ? <QueueConnectorEventForm actionId={action.id} /> : <span className="text-xs text-muted-foreground">Enable first</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function SupportEscalationSection({ automationEndpoints }: { automationEndpoints: WebhookEndpointRow[] }) {
  const ticketEndpoints = automationEndpoints.filter(
    (endpoint) => endpoint.active && endpoint.events.some((event) => event === 'ticket.created' || event === 'ticket.resolved'),
  );
  const supportItems = [
    {
      icon: Inbox,
      title: 'Ticket manager',
      body: 'When staff report an issue or the assistant cannot solve it, route the conversation into the team inbox and manage priority, tags, and internal notes.',
      href: '/company/inbox',
      cta: 'Open inbox',
    },
    {
      icon: Bell,
      title: 'Notifications',
      body: 'Send important ticket, lead, or system alerts to email, WhatsApp, Slack, or webhook recipients.',
      href: '/company/notifications',
      cta: 'Notification rules',
    },
    {
      icon: MessageSquare,
      title: 'WhatsApp channel',
      body: 'Connect your own WhatsApp for customer messages, or get notified when something needs a person.',
      href: '/company/channels',
      cta: 'Connect WhatsApp',
    },
    {
      icon: Settings,
      title: 'Support rules',
      body: 'Configure response-time targets, business hours, and routing rules for the team inbox.',
      href: '/company/support-settings',
      cta: 'Support settings',
    },
    {
      icon: PlugZap,
      title: 'Ticket automations',
      body: 'Send ticket created/resolved events to Slack, Jira, Zapier, Make, webhooks, or your custom CRM.',
      href: '/company/webhooks',
      cta: 'Manage automations',
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Report a Help Desk issue</CardTitle>
          <p className="text-sm text-muted-foreground">
            Creates an unread company notification and sends it through configured email, WhatsApp, Slack, or webhook delivery rules.
          </p>
        </CardHeader>
        <CardContent>
          <HelpdeskIssueReportForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Getting help to a person</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-5">
            {supportItems.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="rounded-md border p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Icon className="h-4 w-4 text-primary" />
                    {item.title}
                  </div>
                  <p className="mt-2 min-h-20 text-xs leading-5 text-muted-foreground">{item.body}</p>
                  <Button asChild size="sm" variant="outline" className="mt-3">
                    <Link href={item.href}>{item.cta}</Link>
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Automation delivery preview</CardTitle>
          <p className="text-sm text-muted-foreground">
            Ticket events will be sent to these active destinations when a ticket is created or resolved.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {ticketEndpoints.length ? (
            <div className="grid gap-3 md:grid-cols-3">
              {ticketEndpoints.map((endpoint) => (
                <div key={endpoint.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{endpoint.label || (endpoint.kind === 'slack' ? 'Slack' : 'Webhook')}</p>
                    <Badge variant={endpoint.lastStatus === 'failed' ? 'destructive' : 'success'}>{endpoint.kind}</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{endpoint.urlPreview}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Events: {endpoint.events.filter((event) => event === 'ticket.created' || event === 'ticket.resolved').join(', ')}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <Alert tone="warning" className="px-3 py-2">
              No active ticket automations yet. Add Slack, Jira, CRM, Zapier, Make, or a custom webhook so ticket.created and ticket.resolved events leave this dashboard.
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <TicketAutomationTestButton />
            <Button asChild size="sm">
              <Link href="/company/webhooks">Manage automations</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/company/support-settings">Connector auto-ticket settings</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recommended issue flow</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          {[
            'Staff asks Help Desk',
            'Assistant answers or runs a safe connector action',
            'If it is still not sorted, your team raises a request',
            'Support team gets context, route, logs, and priority',
            'Updates go through Inbox and optional WhatsApp notifications',
          ].map((step, index) => (
            <div key={step} className="rounded-md border p-3">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {index + 1}
              </span>
              <p className="mt-3 text-sm font-medium">{step}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ConnectorPowerMap() {
  const steps = [
    {
      icon: Database,
      title: 'Software sends its map',
      body: 'The SDK syncs modules, screens, menu paths, fields, common errors, and help text as draft documentation.',
    },
    {
      icon: CheckCircle2,
      title: 'Admin approves knowledge',
      body: 'Draft docs are reviewed before indexing, so the assistant learns the software from trusted content only.',
    },
    {
      icon: ShieldCheck,
      title: 'Actions stay controlled',
      body: 'Each action declares risk, roles, required fields, and confirmation rules before the bot can use it.',
    },
    {
      icon: Workflow,
      title: 'Live work runs locally',
      body: 'The bot queues events; the connector executes inside the customer system and returns structured results.',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>How connectors make Switch&amp;Save more powerful</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-4">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.title} className="rounded-md border p-3">
                <div className="grid h-9 w-9 place-items-center rounded-md bg-violet-50 text-[#5b3ff4]">
                  <Icon className="h-4 w-4" />
                </div>
                <p className="mt-3 text-sm font-medium">{step.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.body}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default async function HelpDeskPage({
  searchParams,
}: {
  searchParams?: { tab?: string; healthLogPage?: string };
}) {
  const companyId = await getCompanyId();
  const [workspace, bots, replyUsage, automationEndpoints] = await Promise.all([
    getHelpdeskConnectorWorkspace({ healthLogPage: Number(searchParams?.healthLogPage ?? 1) }),
    listBots(),
    getReplyAllowanceUsage(companyId),
    listWebhookEndpoints(),
  ]);
  const draftCount = workspace.draftDocuments.length;
  const enabledActionCount = workspace.actions.filter((action) => action.isEnabled).length;
  const onlineCount = workspace.connectors.filter((connector) => connector.connectionState === 'connected').length;
  const healthAlerts = connectorHealthAlerts(workspace.connectors);
  const internalBot = bots.find((bot) => bot.assistantAudience === 'internal');
  const assistantHref = internalBot ? `/company/bots/${internalBot.id}/settings` : '/company/bots/new';
  const assistantLabel = internalBot ? 'Edit help desk bot' : 'Create help desk bot';
  const activeTab = normalizeTab(searchParams?.tab);
  const draftGroups = workspace.connectors
    .map((connector) => ({
      connector,
      documents: workspace.draftDocuments.filter((doc) => doc.connectorId === connector.id),
    }))
    .filter((group) => group.documents.length > 0);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Staff help desk"
        description="The same idea, pointed at your own team instead of your customers: they ask how something works, it answers, and anything it cannot sort goes to a person."
        actions={
          <Button asChild variant="outline">
            <Link href={assistantHref}>{assistantLabel}</Link>
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <StatTile label="Connectors" value={workspace.connectors.length} />
        <StatTile label="Draft docs" value={draftCount} />
        <StatTile label="Enabled actions" value={enabledActionCount} />
        <StatTile label="Online connectors" value={onlineCount} />
      </div>

      <HelpDeskTabs active={activeTab} />

      {activeTab === 'overview' ? (
        <HelpDeskOverview
          workspace={workspace}
          replyUsage={replyUsage}
          assistantHref={assistantHref}
          assistantLabel={assistantLabel}
          draftCount={draftCount}
          enabledActionCount={enabledActionCount}
          onlineCount={onlineCount}
        />
      ) : null}

      {activeTab === 'ask' ? (
        <HelpdeskInternalChat
          initialPills={workspace.quickPills}
          settings={workspace.chatSettings}
          initialReplyUsage={replyUsage}
          connectorHealthAlerts={healthAlerts}
        />
      ) : null}

      {activeTab === 'connect' ? (
        <>
          <HowConnectorsWork />
          <ConnectorPowerMap />
          <WhatIsChecked />
          <DeliveryExplanation />
          <Card>
            <CardHeader>
              <CardTitle>Why the chat can say not available</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border p-3">
                <p className="text-sm font-semibold">Staff access</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Chat visibility does not block by staff role. The customer app decides where to mount it; individual actions can still enforce role safety.
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-sm font-semibold">Route targeting</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {workspace.chatSettings.allowedRoutes.length
                    ? `Only these routes show chat: ${workspace.chatSettings.allowedRoutes.join(', ')}.`
                    : 'No route allow-list. Chat can show on every staff route unless blocked.'}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-sm font-semibold">Blocked routes</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  These always block chat: {workspace.chatSettings.blockedRoutes.join(', ') || 'none'}.
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* `DeveloperPackages` used to render here as well as further down the same
          tab, putting sixteen identical Download buttons and two "Base URL"
          blocks on one screen. It now appears exactly once, below. */}
      {activeTab === 'connect' ? <ManualSetupGuide /> : null}

      {activeTab === 'settings' ? (
        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] [&>*]:min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>Where the Help Desk chat appears</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert tone="info" className="px-3 py-2 text-xs leading-5">
                If Ask failed: Help Desk chat is not available appears, check this form first. Add the current route or remove an over-broad blocked route.
              </Alert>
              <HelpdeskChatSettingsForm settings={workspace.chatSettings} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Current visibility rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-md border p-3">
                <p className="font-semibold">Enabled</p>
                <p className="text-muted-foreground">{workspace.chatSettings.enabled ? 'Yes' : 'No'} / {workspace.chatSettings.showMode}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="font-semibold">Staff access</p>
                <p className="text-muted-foreground">Any staff role can open chat when the customer app shows it. Action permissions are checked separately.</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="font-semibold">Route rule</p>
                <p className="text-muted-foreground">
                  {workspace.chatSettings.allowedRoutes.length
                    ? `Only selected routes show chat: ${workspace.chatSettings.allowedRoutes.join(', ')}. Blocked routes still override.`
                    : 'All staff routes can show chat unless they match a blocked route.'}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeTab === 'connect' ? (
        <>
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] [&>*]:min-w-0">
            <Card>
              <CardHeader>
                <CardTitle>Create connector</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Create one connector, copy its token once, then download the matching package. Node/Laravel/React/Vue use a web token but have separate packages.
                </p>
                <HelpdeskConnectorForm />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>For your developer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Everything below is for whoever installs this in your software. You do not need to
                  read it.
                </p>
                {/* Raw endpoints and auth headers, kept but clearly labelled and
                    collapsed, so the business owner is not asked to parse them. */}
                <details className="rounded-md border bg-muted/20 p-3">
                  <summary className="cursor-pointer text-sm font-medium">Technical details</summary>
                  <div className="mt-3 space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Every request sends <span className="font-mono">Authorization: Bearer YOUR_TOKEN</span>. Sync creates draft docs/actions; polling receives events when WebSocket is unavailable.
                    </p>
                    <ApiEndpoints />
                  </div>
                </details>
              </CardContent>
            </Card>
          </div>
          <DeveloperPackages />
          <Card>
            <CardHeader>
              <CardTitle>How updates reach connectors</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Each connector has a manifest revision. When an admin changes connector settings or clicks resync, the revision increases.
              </p>
              <p>
                Installed SDKs call status/events, see <span className="font-mono">syncRequired</span>, then resend their docs and action manifest.
              </p>
              <p>
                If you add a brand-new action, the developer still adds a local handler in the connected system. The platform never writes directly to their database.
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}

      {activeTab === 'knowledge' ? (
        <>
          <Card>
        <CardHeader>
          <CardTitle>Connected systems</CardTitle>
        </CardHeader>
        <CardContent>
          {workspace.connectors.length === 0 ? (
            // Module 4 — same story as the Connect tab, so use the same destination.
            <div className="space-y-3">
              <p className="max-w-2xl text-sm text-muted-foreground">
                No systems connected yet. There is nothing to review until a connector is installed in your
                software and has synced its screens.
              </p>
              <Button asChild size="sm">
                <Link href="/company/help-desk?tab=connect">Connect software</Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Docs</TableHead>
                  <TableHead>Actions</TableHead>
                  <TableHead>Revision</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspace.connectors.map((connector) => (
                  <TableRow key={connector.id}>
                    <TableCell>
                      <div className="font-medium">{connector.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{connector.publicId}</div>
                    </TableCell>
                    <TableCell>{platformLabel(connector.platform)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(connector.status)}>{companyLabel('connectorStatus', connector.status)}</Badge>
                    </TableCell>
                    <TableCell>
                      {connector.approvedDocs} approved, {connector.draftDocs} draft
                    </TableCell>
                    <TableCell>
                      {connector.enabledActions} enabled, {connector.actions} total
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-sm">v{connector.manifestRevision}</div>
                      {connector.resyncRequestedAt ? (
                        <div className="text-xs text-muted-foreground">requested {formatDate(connector.resyncRequestedAt)}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{companyLabel('deliveryMode', connector.activeDeliveryMode ?? 'unknown')}</div>
                      <div className="text-xs text-muted-foreground">{companyLabel('connectionState', connector.connectionState ?? 'unknown')}</div>
                      {connector.lastEventLatencyMs != null ? (
                        <Badge variant={latencyVariant(connector.lastEventLatencyMs)} className="mt-1">
                          {connector.lastEventLatencyMs} ms
                        </Badge>
                      ) : null}
                      {connector.lastError ? <div className="max-w-40 truncate text-xs text-destructive">{connector.lastError}</div> : null}
                    </TableCell>
                    <TableCell>{connector.lastSeenAt ? formatDate(connector.lastSeenAt) : 'Never'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <ConnectorTestButton connectorId={connector.id} />
                        <ConnectorResyncButton connectorId={connector.id} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connector review queue</CardTitle>
          <p className="text-sm text-muted-foreground">
            One row is kept for each stable screen key. Resync updates these rows; it should not create copies unless the connector sends a new key.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {draftGroups.length === 0 ? (
            // Module 5 — review queue is empty; a resync is the only thing that refills it.
            <div className="space-y-3">
              <p className="max-w-2xl text-sm text-muted-foreground">
                Nothing waiting for review. Each screen keeps one row here, so a resync updates what you already
                approved rather than adding copies.
              </p>
              <Button asChild size="sm" variant="outline">
                <Link href="/company/help-desk?tab=connect">Open connector setup</Link>
              </Button>
            </div>
          ) : (
            draftGroups.map((group) => (
              <div key={group.connector.id} className="rounded-md border bg-muted/20 p-3">
                <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-medium">{group.connector.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {group.documents.length} draft item{group.documents.length === 1 ? '' : 's'} - resync updates the same stable keys.
                    </p>
                  </div>
                  <ConnectorResyncButton connectorId={group.connector.id} />
                </div>
                <div className="space-y-3">
                  {group.documents.map((doc) => (
                    <HelpdeskDocumentReview key={doc.id} doc={doc} platformLabel={platformLabel(doc.platform)} />
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What it is allowed to do</CardTitle>
        </CardHeader>
        <CardContent>
          {workspace.actions.length === 0 ? (
            // Module 6 — mirrors the Actions tab empty state.
            <div className="space-y-3">
              <p className="max-w-2xl text-sm text-muted-foreground">
                No actions registered yet. The starter connectors ship with POS-style actions like search product
                and end-of-day report; they appear here after the first sync.
              </p>
              <Button asChild size="sm" variant="outline">
                <Link href="/company/help-desk?tab=connect">Open connector setup</Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Connector</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Fields</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Test</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspace.actions.map((action) => (
                  <TableRow key={action.id}>
                    <TableCell>
                      <div className="font-mono text-sm">{action.name}</div>
                      <div className="text-xs text-muted-foreground">{action.description}</div>
                      {action.needsConfirmation ? (
                        <Badge variant="warning" className="mt-1">Needs confirmation</Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>{action.connectorName}</TableCell>
                    <TableCell>
                      <Badge variant={action.risk === 'high' ? 'destructive' : action.risk === 'medium' ? 'warning' : 'secondary'}>
                        {companyLabel('actionRisk', action.risk)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      Required: {action.requiredFields.join(', ') || 'none'}
                    </TableCell>
                    <TableCell>
                      <form action={setConnectorActionEnabledAction} className="flex items-center gap-2">
                        <input type="hidden" name="actionId" value={action.id} />
                        <label className="flex items-center gap-1 text-xs">
                          <input name="enabled" type="checkbox" defaultChecked={action.isEnabled} className="h-4 w-4" />
                          Enabled
                        </label>
                        {action.actionType === 'read' || action.actionType === 'report' ? (
                          <label className="flex items-center gap-1 text-xs">
                            <input
                              name="confirmationRequired"
                              type="checkbox"
                              defaultChecked={action.needsConfirmation}
                              className="h-4 w-4"
                            />
                            Confirm
                          </label>
                        ) : (
                          <>
                            <input type="hidden" name="confirmationRequired" value="on" />
                            <span className="text-xs text-muted-foreground">Confirm always</span>
                          </>
                        )}
                        <Button type="submit" size="sm" variant="outline">Save</Button>
                      </form>
                    </TableCell>
                    <TableCell>
                      {action.isEnabled ? <QueueConnectorEventForm actionId={action.id} /> : <span className="text-xs text-muted-foreground">Enable first</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
        </>
      ) : null}

      {activeTab === 'actions' ? (
        <ActionsSection workspace={workspace} />
      ) : null}

      {activeTab === 'support' ? (
        <SupportEscalationSection automationEndpoints={automationEndpoints} />
      ) : null}

      {activeTab === 'logs' ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Connector monitoring</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border p-3">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Recent health logs (last {workspace.healthLogWindowDays} days)
                  </p>
                  {/* One page of them, not all of them — saying "25" when there
                      are thousands is worse than saying "25+". */}
                  <p className="mt-1 text-2xl font-semibold">
                    {workspace.healthLogsHaveMore
                      ? `${workspace.healthLogPageSize}+`
                      : workspace.healthLogs.length}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Generated pills</p>
                  <p className="mt-1 text-2xl font-semibold">{workspace.connectorGeneratedPills}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Recent events</p>
                  <p className="mt-1 text-2xl font-semibold">{workspace.events.length}</p>
                </div>
              </div>
              <div className="max-h-80 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Connector</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workspace.healthLogs.length ? (
                      workspace.healthLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs">{formatDate(log.createdAt)}</TableCell>
                          <TableCell>{log.connectorName}</TableCell>
                          <TableCell>
                            <div className="font-mono text-xs">{log.eventType}</div>
                            {log.message ? <div className="max-w-xs truncate text-xs text-muted-foreground">{log.message}</div> : null}
                          </TableCell>
                          <TableCell>
                            <Badge variant={log.status === 'success' ? 'success' : log.status === 'error' ? 'destructive' : 'secondary'}>
                              {log.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={4} className="p-0">
                          {/* Module 7 — a log, not a task: explain what fills it, no button. */}
                          <EmptyState
                            title="No health logs yet."
                            body="Connections, syncs, and errors are recorded here once a connector starts reporting in."
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {/* The table reads one page at a time now, so without these the
                  older entries exist and are unreachable. */}
              {workspace.healthLogsHaveMore || workspace.healthLogPage > 1 ? (
                <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Page {workspace.healthLogPage}</span>
                  <div className="flex gap-2">
                    {workspace.healthLogPage > 1 ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`?tab=logs&healthLogPage=${workspace.healthLogPage - 1}`}>
                          Newer
                        </Link>
                      </Button>
                    ) : null}
                    {workspace.healthLogsHaveMore ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`?tab=logs&healthLogPage=${workspace.healthLogPage + 1}`}>
                          Older
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
        <CardHeader>
          <CardTitle>Help Desk audit trail</CardTitle>
        </CardHeader>
        <CardContent>
          {workspace.auditLogs.length === 0 ? (
            // Module 8 — a log, not a task: explain what fills it, no button.
            <p className="max-w-2xl text-sm text-muted-foreground">
              No audit trail yet. Every staff question and every action the assistant runs is recorded here, with
              who confirmed it and whether it was a dry run.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Action / Question</TableHead>
                  <TableHead>Connector</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Safety</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspace.auditLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs">{formatDate(log.createdAt)}</TableCell>
                    <TableCell>{log.source}</TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{log.actionName ?? 'chat'}</div>
                      {log.question ? <div className="max-w-md truncate text-xs text-muted-foreground">{log.question}</div> : null}
                      {log.errorMessage ? <div className="max-w-md truncate text-xs text-destructive">{log.errorMessage}</div> : null}
                    </TableCell>
                    <TableCell>{log.connectorName ?? '-'}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(log.status)}>{companyLabel('eventStatus', log.status)}</Badge>
                    </TableCell>
                    <TableCell className="space-x-1 rtl:space-x-reverse">
                      {log.confirmationRequired ? <Badge variant="warning">confirm</Badge> : null}
                      {log.confirmed ? <Badge variant="success">confirmed</Badge> : null}
                      {log.dryRun ? <Badge variant="secondary">dry-run</Badge> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent connector events</CardTitle>
        </CardHeader>
        <CardContent>
          {workspace.events.length === 0 ? (
            // Module 9 — testing an action is the sensible next step here.
            <div className="space-y-3">
              <p className="max-w-2xl text-sm text-muted-foreground">
                No events yet. Each time the assistant asks your software to do something, the request and its
                result land here. Send a test event from an enabled action to see one.
              </p>
              <Button asChild size="sm" variant="outline">
                <Link href="/company/help-desk?tab=actions">Test an action</Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Connector</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspace.events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-mono text-sm">{event.eventName}</TableCell>
                    <TableCell>{event.connectorName}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(event.status)}>{companyLabel('eventStatus', event.status)}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(event.createdAt)}</TableCell>
                    <TableCell className="max-w-md truncate text-xs text-muted-foreground">{event.errorMessage ?? '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
        </>
      ) : null}
    </div>
  );
}
