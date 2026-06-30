import Link from 'next/link';
import {
  AlertCircle,
  BookOpen,
  Cable,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Download,
  FilePenLine,
  Package,
  RefreshCw,
  Settings,
  ShieldCheck,
  Terminal,
  Workflow,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { env } from '@/lib/env';
import { formatDate } from '@/lib/format';
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
import { HelpdeskChatPreview } from '@/modules/company/components/helpdesk-chat-preview';
import { HelpdeskInternalChat } from '@/modules/company/components/helpdesk-internal-chat';
import { HelpdeskChatSettingsForm } from '@/modules/company/components/helpdesk-chat-settings-form';
import { HelpdeskDocumentReview } from '@/modules/company/components/helpdesk-document-review';
import { listBots } from '@/modules/company/data';

function platformLabel(platform: string) {
  if (platform === 'dotnet') return '.NET';
  if (platform === 'android') return 'Android';
  if (platform === 'web') return 'Web';
  return platform;
}

function statusVariant(status: string): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (['active', 'approved', 'completed'].includes(status)) return 'success';
  if (['draft', 'queued', 'running'].includes(status)) return 'warning';
  if (['failed', 'rejected', 'revoked'].includes(status)) return 'destructive';
  return 'secondary';
}

const helpDeskTabs = [
  { key: 'overview', label: 'Overview', hint: 'Status and chat', icon: ClipboardCheck },
  { key: 'install', label: 'Install', hint: 'Create and download', icon: Package },
  { key: 'checks', label: 'Checks', hint: 'What is verified', icon: CheckCircle2 },
  { key: 'manual', label: 'Manual setup', hint: 'Add screens/actions', icon: FilePenLine },
  { key: 'review', label: 'Review', hint: 'Docs and actions', icon: BookOpen },
  { key: 'logs', label: 'Logs', hint: 'Sync and events', icon: Terminal },
  { key: 'settings', label: 'Settings', hint: 'Roles and routes', icon: Settings },
] as const;

type HelpDeskTab = (typeof helpDeskTabs)[number]['key'];

function normalizeTab(value: string | undefined): HelpDeskTab {
  return helpDeskTabs.some((tab) => tab.key === value) ? (value as HelpDeskTab) : 'overview';
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
                'rounded-md border px-3 py-2 text-left transition-colors',
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>What the system is checking</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {checks.map((check) => (
          <div key={check.title} className="rounded-md border p-3">
            <p className="text-sm font-semibold">{check.title}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{check.body}</p>
          </div>
        ))}
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
    <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Manual setup flow</CardTitle>
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
          <CardTitle>Where to add your own screens/actions</CardTitle>
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
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
            If your POS only shows seven screens, that means only seven screens were included in the manifest. Add more screens in the details file, then run Sync again.
          </div>
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
        <Button asChild variant="outline" size="sm">
          <Link href="/api/helpdesk/connectors/schema">View required action format</Link>
        </Button>
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

export default async function HelpDeskPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const [workspace, bots] = await Promise.all([getHelpdeskConnectorWorkspace(), listBots()]);
  const draftCount = workspace.draftDocuments.length;
  const enabledActionCount = workspace.actions.filter((action) => action.isEnabled).length;
  const onlineCount = workspace.connectors.filter((connector) => connector.connectionState === 'connected').length;
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
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Help Desk Connectors</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Connect .NET POS and Android apps, sync reviewed help docs, and expose approved events without storing customer database records.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={assistantHref}>{assistantLabel}</Link>
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Connectors</p>
            <p className="mt-1 text-2xl font-semibold">{workspace.connectors.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Draft docs</p>
            <p className="mt-1 text-2xl font-semibold">{draftCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Enabled actions</p>
            <p className="mt-1 text-2xl font-semibold">{enabledActionCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Online connectors</p>
            <p className="mt-1 text-2xl font-semibold">{onlineCount}</p>
          </CardContent>
        </Card>
      </div>

      <HelpDeskTabs active={activeTab} />

      {activeTab === 'overview' ? (
        <>
          <HelpdeskInternalChat initialPills={workspace.quickPills} settings={workspace.chatSettings} />
          <HelpdeskChatPreview suggestions={workspace.quickPills} />
          <ConnectorPowerMap />
          <DeliveryExplanation />
        </>
      ) : null}

      {activeTab === 'checks' ? (
        <>
          <WhatIsChecked />
          <DeliveryExplanation />
          <Card>
            <CardHeader>
              <CardTitle>Why the chat can say “not available”</CardTitle>
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

      {activeTab === 'manual' ? (
        <>
          <ManualSetupGuide />
          <DeveloperPackages />
        </>
      ) : null}

      {activeTab === 'settings' ? (
        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <Card>
            <CardHeader>
              <CardTitle>Where the Help Desk chat appears</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-950">
                If “Ask failed: Help Desk chat is not available” appears, check this form first. Add the staff role and current route, or remove an over-broad blocked route.
              </div>
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

      {activeTab === 'install' ? (
        <>
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
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
                <CardTitle>Connector API</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Every request sends <span className="font-mono">Authorization: Bearer YOUR_TOKEN</span>. Sync creates draft docs/actions; polling receives events when WebSocket is unavailable.
                </p>
                <ApiEndpoints />
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

      {activeTab === 'review' ? (
        <>
          <Card>
        <CardHeader>
          <CardTitle>Connected systems</CardTitle>
        </CardHeader>
        <CardContent>
          {workspace.connectors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No connectors yet. Create one above, then run the .NET or Android starter.</p>
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
                      <Badge variant={statusVariant(connector.status)}>{connector.status}</Badge>
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
                      <div className="text-sm">{connector.activeDeliveryMode ?? 'unknown'}</div>
                      <div className="text-xs text-muted-foreground">{connector.connectionState ?? 'unknown'}</div>
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
            <p className="text-sm text-muted-foreground">No draft docs waiting. Run connector sync to generate editable help drafts.</p>
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
          <CardTitle>Approved action manifest</CardTitle>
        </CardHeader>
        <CardContent>
          {workspace.actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No actions registered yet. The starter connectors include POS-style actions like search product and end-of-day report.</p>
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
                        {action.actionType} / {action.risk}
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

      {activeTab === 'logs' ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Connector monitoring</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border p-3">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Recent health logs</p>
                  <p className="mt-1 text-2xl font-semibold">{workspace.healthLogs.length}</p>
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
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                          No health logs yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
        <CardHeader>
          <CardTitle>Help Desk audit trail</CardTitle>
        </CardHeader>
        <CardContent>
          {workspace.auditLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Help Desk chat or action audit logs yet.</p>
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
                      <Badge variant={statusVariant(log.status)}>{log.status}</Badge>
                    </TableCell>
                    <TableCell className="space-x-1">
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
            <p className="text-sm text-muted-foreground">No events yet. Queue a sandbox event after actions sync.</p>
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
                      <Badge variant={statusVariant(event.status)}>{event.status}</Badge>
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
