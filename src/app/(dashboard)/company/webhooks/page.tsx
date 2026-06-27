import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import {
  listWebhookEndpoints,
  recentDeliveries,
  webhookUsage,
} from '@/modules/company/webhooks-data';
import {
  deleteWebhookAction,
  toggleWebhookAction,
  testWebhookAction,
} from '@/modules/company/webhooks-actions';
import { WebhookForm } from '@/modules/company/components/webhook-form';

const codeBlock = 'overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed';

const PAYLOAD_EXAMPLE = `POST  (your endpoint)
Content-Type: application/json
X-Webhook-Event: lead.created
X-Webhook-Signature: sha256=<hmac>

{
  "event": "lead.created",
  "created_at": "2026-06-26T10:00:00.000Z",
  "company_id": "…",
  "title": "New lead",
  "body": "Jane Doe — jane@example.com",
  "data": { "name": "Jane Doe", "email": "jane@example.com" }
}`;

const VERIFY_EXAMPLE = `// Verify the signature (Node.js)
import crypto from 'crypto';

const signature = req.headers['x-webhook-signature']; // "sha256=…"
const expected =
  'sha256=' +
  crypto.createHmac('sha256', YOUR_SIGNING_SECRET)
        .update(rawRequestBody)        // the exact bytes you received
        .digest('hex');

if (signature !== expected) reject(401); // not from us`;

export default async function WebhooksPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [endpoints, deliveries, usage] = await Promise.all([
    listWebhookEndpoints(),
    recentDeliveries(20),
    webhookUsage(),
  ]);

  const monthlyLimit = usage.limits.monthly;
  const pct = monthlyLimit ? Math.min(100, Math.round((usage.used / monthlyLimit) * 100)) : 0;
  const atEndpointLimit = usage.endpointCount >= usage.limits.maxEndpoints;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Webhooks &amp; integrations</h1>
        <p className="text-sm text-muted-foreground">
          Push new leads, appointments, and orders into your own systems — a generic
          signed webhook, Slack, or any of 5,000+ apps via Zapier / Make.
        </p>
      </div>

      {/* Usage / limits (server-cost control) */}
      <Card>
        <CardHeader>
          <CardTitle>Your usage this month</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-3 text-sm">
            <div>
              <div className="text-muted-foreground">Deliveries used</div>
              <div className="text-lg font-semibold">
                {usage.used.toLocaleString()}
                {monthlyLimit ? ` / ${monthlyLimit.toLocaleString()}` : ' / unlimited'}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Endpoints</div>
              <div className="text-lg font-semibold">
                {usage.endpointCount} / {usage.limits.maxEndpoints}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Plan</div>
              <div className="text-lg font-semibold capitalize">{usage.plan ?? 'trial'}</div>
            </div>
          </div>
          {monthlyLimit ? (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full ${pct >= 100 ? 'bg-destructive' : 'bg-primary'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            A &quot;delivery&quot; is one event sent to one endpoint. Over the monthly limit,
            events are skipped (logged below) until the next month or a plan upgrade.
            Each event retries once on failure.
          </p>
        </CardContent>
      </Card>

      {/* Add endpoint */}
      <Card>
        <CardHeader>
          <CardTitle>Add a webhook</CardTitle>
        </CardHeader>
        <CardContent>
          <WebhookForm atLimit={atEndpointLimit} />
        </CardContent>
      </Card>

      {/* Existing endpoints */}
      <Card>
        <CardHeader>
          <CardTitle>Your endpoints</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {endpoints.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No webhooks yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Destination</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last delivery</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map((ep) => (
                  <TableRow key={ep.id}>
                    <TableCell>
                      <div className="font-medium">
                        {ep.label || (ep.kind === 'slack' ? 'Slack' : 'Webhook')}
                      </div>
                      <div className="text-xs text-muted-foreground break-all">{ep.urlPreview}</div>
                      {ep.secret ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Signing secret: <code className="rounded bg-muted px-1">{ep.secret}</code>
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">{ep.events.join(', ')}</TableCell>
                    <TableCell>
                      <Badge variant={ep.active ? 'success' : 'outline'}>
                        {ep.active ? 'active' : 'paused'}
                      </Badge>
                      {ep.lastStatus ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          last: {ep.lastStatus}
                          {ep.failureCount > 0 ? ` (${ep.failureCount} fails)` : ''}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      {ep.lastDeliveryAt ? formatDate(ep.lastDeliveryAt) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <form action={testWebhookAction}>
                          <input type="hidden" name="id" value={ep.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Test
                          </Button>
                        </form>
                        <form action={toggleWebhookAction}>
                          <input type="hidden" name="id" value={ep.id} />
                          <input type="hidden" name="active" value={ep.active ? 'false' : 'true'} />
                          <Button type="submit" variant="outline" size="sm">
                            {ep.active ? 'Pause' : 'Resume'}
                          </Button>
                        </form>
                        <form action={deleteWebhookAction}>
                          <input type="hidden" name="id" value={ep.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            Delete
                          </Button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent deliveries log */}
      <Card>
        <CardHeader>
          <CardTitle>Recent deliveries</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {deliveries.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No deliveries yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-xs">{d.event}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          d.status === 'success'
                            ? 'success'
                            : d.status === 'skipped'
                            ? 'outline'
                            : 'destructive'
                        }
                      >
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{d.statusCode ?? '—'}</TableCell>
                    <TableCell className="text-xs">{d.attempts}</TableCell>
                    <TableCell className="text-xs">{formatDate(d.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Documentation */}
      <Card>
        <CardHeader>
          <CardTitle>How to use webhooks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          <div>
            <h3 className="font-medium">1. Events we send</h3>
            <ul className="ml-5 list-disc text-muted-foreground">
              <li>
                <code>lead.created</code> — a new lead is captured
              </li>
              <li>
                <code>appointment.created</code> — a new appointment request
              </li>
              <li>
                <code>order.created</code> — a new order is placed via chat
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-medium">2. What we POST to your endpoint</h3>
            <pre className={codeBlock}>{PAYLOAD_EXAMPLE}</pre>
          </div>

          <div>
            <h3 className="font-medium">3. Verify it&apos;s really from us</h3>
            <p className="text-muted-foreground">
              Every generic webhook is signed with HMAC-SHA256 using your endpoint&apos;s
              signing secret (shown next to the endpoint above). Recompute it and compare:
            </p>
            <pre className={codeBlock}>{VERIFY_EXAMPLE}</pre>
          </div>

          <div>
            <h3 className="font-medium">4. Connect Slack</h3>
            <p className="text-muted-foreground">
              In Slack: <em>Apps → Incoming Webhooks → Add to a channel</em>, copy the URL,
              then add it here as a <strong>Slack</strong> webhook. You&apos;ll get a message
              in that channel for each event you choose.
            </p>
          </div>

          <div>
            <h3 className="font-medium">5. Connect 5,000+ apps (Zapier / Make)</h3>
            <p className="text-muted-foreground">
              In Zapier or Make create a trigger of type <em>&quot;Webhooks → Catch Hook&quot;</em>,
              copy the URL it gives you, and add it here as a <strong>Generic</strong> webhook.
              From there you can send leads/orders to Google Sheets, HubSpot, Salesforce,
              Mailchimp, and more — no coding.
            </p>
          </div>

          <div>
            <h3 className="font-medium">6. Limits</h3>
            <p className="text-muted-foreground">
              Your plan includes a monthly delivery budget and a maximum number of endpoints
              (shown at the top). This keeps the service fast and fair. Need more? Upgrade your
              plan or contact us for a custom limit.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
