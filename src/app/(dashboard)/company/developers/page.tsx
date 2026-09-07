import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { env } from '@/lib/env';
import { API_RATE_LIMIT_PER_MINUTE } from '@/lib/api/handler';
import { API_SCOPES, API_SCOPE_LABELS } from '@/lib/api-keys';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { UpgradeNotice } from '@/components/ui/upgrade-notice';
import { companyHasFeature, requireCompanyFeature } from '@/lib/entitlements';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { CopyButton } from '@/components/copy-button';
import { formatDate } from '@/lib/format';
import {
  apiUsageSummary,
  listApiKeys,
  recentApiRequests,
  webhookEventCatalogue,
} from '@/modules/company/developers-data';
import { revokeApiKeyAction } from '@/modules/company/developers-actions';
import { ApiKeyForm } from '@/modules/company/components/api-key-form';
import { WebhookEventsPanel } from '@/modules/company/components/webhook-events-panel';

// Keys, logs and the event catalogue all change under the user's hands.
export const dynamic = 'force-dynamic';

// The gate below decides what this page draws; this decides what a post can do.
// A form that is never rendered is still reachable with a crafted request.
async function revoke(formData: FormData) {
  'use server';
  await requireCompanyFeature('api_access');
  await revokeApiKeyAction(formData);
}

const codeBlock = 'overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed';

function curlSnippet(baseUrl: string): string {
  return `# List the 25 most recent conversations
curl "${baseUrl}/api/v1/conversations?per_page=25" \\
  -H "Authorization: Bearer ak_live_YOUR_KEY"

# Send a message into a conversation
curl -X POST "${baseUrl}/api/v1/messages" \\
  -H "Authorization: Bearer ak_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"conversation_id":"<uuid>","text":"Your order shipped."}'`;
}

function sdkSnippet(baseUrl: string): string {
  return `<script src="${baseUrl}/sdk/assistant.js"></script>
<script>
  // Server-side only: an API key must never ship in a browser bundle.
  const assistant = new AIAssistant({
    apiKey: process.env.ASSISTANT_API_KEY,
    baseUrl: '${baseUrl}',
  });

  const { data, meta } = await assistant.conversations.list({ status: 'human_active' });
  console.log(meta.total, data[0]);

  await assistant.messages.send({ conversation_id: data[0].id, text: 'Hello 👋' });
</script>`;
}

export default async function DevelopersPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  // Keys a company already holds keep working against `/api/v1` until support
  // revokes them; this only closes the screen that mints and reads them.
  if (!(await companyHasFeature('api_access'))) {
    return <UpgradeNotice feature="api_access" title="Developers" />;
  }

  const [keys, requests, usage, events] = await Promise.all([
    listApiKeys(),
    recentApiRequests(25),
    apiUsageSummary(),
    webhookEventCatalogue(),
  ]);

  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  const scopeOptions = API_SCOPES.map((scope) => ({
    value: scope,
    label: API_SCOPE_LABELS[scope],
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Developers"
        description="Build on your assistant: a REST API, signed webhooks, and a JavaScript SDK — all scoped to this account."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Requests (24h)" value={usage.last24h.toLocaleString()} />
        <StatTile label="Requests (30d)" value={usage.last30d.toLocaleString()} />
        <StatTile
          label="Errors (24h)"
          value={usage.errors24h.toLocaleString()}
          tone={usage.errors24h > 0 ? 'warning' : 'default'}
          hint="4xx and 5xx responses"
        />
        <StatTile
          label="Live keys"
          value={usage.liveKeys.toLocaleString()}
          hint={`${API_RATE_LIMIT_PER_MINUTE} requests/min per key`}
        />
      </div>

      {/* Desktop: your keys and the request log on the left — the two
          things you actually come here to read — with the create form and
          the quick-start snippet in a rail beside them. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Your keys</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {keys.length === 0 ? (
                <EmptyState
                  title="No API keys yet"
                  body="Create a key to call the REST API from your own systems, a scheduled job, or an automation tool."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Scopes</TableHead>
                      <TableHead>Last used</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="text-end">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((key) => (
                      <TableRow key={key.id}>
                        <TableCell className="align-top">
                          <div className="font-medium">{key.name}</div>
                          <div className="mt-1">
                            {key.state === 'live' ? (
                              <Badge variant="success">Live</Badge>
                            ) : key.state === 'revoked' ? (
                              <Badge variant="destructive">Revoked</Badge>
                            ) : (
                              <Badge variant="warning">Expired</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <code className="font-mono text-xs">{key.keyPrefix}…</code>
                        </TableCell>
                        <TableCell className="max-w-xs align-top">
                          <div className="flex flex-wrap gap-1">
                            {key.scopes.map((scope) => (
                              <Badge
                                key={scope}
                                variant="outline"
                                className="font-mono text-[11px]"
                              >
                                {scope}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="align-top text-xs text-muted-foreground">
                          {key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never'}
                        </TableCell>
                        <TableCell className="align-top text-xs text-muted-foreground">
                          {key.expiresAt ? formatDate(key.expiresAt) : 'Never'}
                        </TableCell>
                        <TableCell className="text-end align-top">
                          {key.state === 'revoked' ? (
                            <span className="text-xs text-muted-foreground">
                              {formatDate(key.revokedAt)}
                            </span>
                          ) : (
                            <form action={revoke}>
                              <input type="hidden" name="id" value={key.id} />
                              <ConfirmSubmit
                                label="Revoke"
                                confirmLabel="Yes, revoke"
                                question="Requests using this key start failing immediately."
                              />
                            </form>
                          )}
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
              <CardTitle>Webhook events</CardTitle>
              <CardDescription>
                Subscribe an endpoint on the{' '}
                <a className="underline" href="/company/webhooks">
                  Webhooks
                </a>{' '}
                screen, then send yourself a test event to check your handler.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {events.length === 0 ? (
                <EmptyState
                  title="Event catalogue unavailable"
                  body="Run the database migrations to load the public webhook event catalogue."
                />
              ) : (
                <WebhookEventsPanel events={events} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent API requests</CardTitle>
              <CardDescription>The last 25 calls made with your keys.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {requests.length === 0 ? (
                <EmptyState
                  title="No API requests yet"
                  body="Once your integration calls the API, every request shows up here with its status and duration."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Request</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(row.createdAt)}
                        </TableCell>
                        <TableCell>
                          <code className="font-mono text-xs">
                            {row.method} {row.path}
                          </code>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.keyName ?? row.keyPrefix ?? 'Deleted key'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              row.status >= 500
                                ? 'destructive'
                                : row.status >= 400
                                  ? 'warning'
                                  : 'success'
                            }
                          >
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.durationMs == null ? '—' : `${row.durationMs} ms`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sticky on desktop: you fill this in while reading the list
            beside it, so it must not scroll away with that list. */}
        <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Card id="create-key">
            <CardHeader>
              <CardTitle>Create an API key</CardTitle>
              <CardDescription>
                The full key is shown once, at creation. We store only a SHA-256 hash, so we cannot
                show it to you again.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ApiKeyForm scopes={scopeOptions} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick start</CardTitle>
              <CardDescription>
                Every endpoint lives under{' '}
                <code className="rounded bg-muted px-1">{baseUrl}/api/v1</code> and is authenticated
                with <code className="rounded bg-muted px-1">Authorization: Bearer</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">curl</p>
                  <CopyButton value={curlSnippet(baseUrl)} />
                </div>
                <pre className={codeBlock}>{curlSnippet(baseUrl)}</pre>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">JavaScript SDK</p>
                  <CopyButton value={sdkSnippet(baseUrl)} />
                </div>
                <pre className={codeBlock}>{sdkSnippet(baseUrl)}</pre>
                <p className="text-xs text-muted-foreground">
                  SDK: <code className="rounded bg-muted px-1">{baseUrl}/sdk/assistant.js</code> ·
                  types: <code className="rounded bg-muted px-1">{baseUrl}/sdk/assistant.d.ts</code>{' '}
                  · full reference in{' '}
                  <code className="rounded bg-muted px-1">docs/PUBLIC_API.md</code>.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
