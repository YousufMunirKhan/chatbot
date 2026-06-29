import Link from 'next/link';
import { CheckCircle2, Database, Download, RefreshCw, ShieldCheck, Workflow } from 'lucide-react';
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

function DeveloperPackages() {
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  const packages = [
    {
      label: 'Web SDK',
      href: '/api/helpdesk/connectors/download/web',
      body: 'JavaScript client for web apps, SaaS admin panels, docs sync, event polling, and action handlers.',
    },
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
        <div className="grid gap-3 sm:grid-cols-3">
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

export default async function HelpDeskPage() {
  const workspace = await getHelpdeskConnectorWorkspace();
  const draftCount = workspace.draftDocuments.length;
  const enabledActionCount = workspace.actions.filter((action) => action.isEnabled).length;
  const onlineCount = workspace.connectors.filter((connector) => connector.connectionState === 'connected').length;

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
          <Link href="/company/bots/new">Create help desk bot</Link>
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

      <HelpdeskInternalChat initialPills={workspace.quickPills} />
      <HelpdeskChatPreview suggestions={workspace.quickPills} />
      <ConnectorPowerMap />

      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle>Where the Help Desk chat appears</CardTitle>
          </CardHeader>
          <CardContent>
            <HelpdeskChatSettingsForm settings={workspace.chatSettings} />
          </CardContent>
        </Card>
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
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Create connector</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Start with .NET for your POS test or Android for mobile apps. The token authenticates the connector; keep it inside the client system.
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
              Every request sends <span className="font-mono">Authorization: Bearer YOUR_TOKEN</span>. The connector syncs docs/actions as drafts, then polls events for live actions.
            </p>
            <ApiEndpoints />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
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
              If you add a brand-new action, the developer still adds a local handler in Android/.NET. The platform never writes directly to their database.
            </p>
          </CardContent>
        </Card>
      </div>

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
          <CardTitle>Draft documentation review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {workspace.draftDocuments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No draft docs waiting. Run connector sync to generate editable help drafts.</p>
          ) : (
            workspace.draftDocuments.map((doc) => (
              <HelpdeskDocumentReview key={doc.id} doc={doc} platformLabel={platformLabel(doc.platform)} />
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
    </div>
  );
}
