import { requireRole } from '@/lib/auth';
import {
  ROLES,
  DELIVERY_STATUS_LABELS,
  PLAN_LABELS,
  humanizeToken,
  labelFor,
} from '@/lib/constants';
import { WEBHOOK_EVENT_LABELS } from '@/lib/webhook-events';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { ConfirmSubmit } from '@/components/confirm-submit';

const codeBlock = 'overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed';

/*
 * The plain names for the event ids now live in `src/lib/webhook-events.ts`,
 * shared with the form that switches them on — this page and that form used to
 * carry separate lists that disagreed with each other. `lead.created` is precise
 * and is what the receiving system needs, so it stays in the docs and in the
 * payload; the two audiences still get different words for the same thing.
 */

/**
 * What the receiving system answered.
 *
 * The column used to be headed "HTTP" and contain a bare number. Anything in the
 * 200s means it arrived; 4xx means the other end rejected it; 5xx means the
 * other end was broken. That is the whole of what an owner needs.
 */
function outcomeFromCode(code: number | null | undefined): string {
  if (code == null) return 'No answer';
  if (code >= 200 && code < 300) return `Accepted (${code})`;
  if (code === 401 || code === 403) return `Refused us (${code})`;
  if (code === 404) return `Address not found (${code})`;
  if (code >= 400 && code < 500) return `Rejected (${code})`;
  return `Their system failed (${code})`;
}

const PAYLOAD_EXAMPLE = `POST  (your endpoint)
Content-Type: application/json
X-Webhook-Event: ticket.created
X-Webhook-Signature: sha256=<hmac>

{
  "event": "ticket.created",
  "created_at": "2026-06-26T10:00:00.000Z",
  "company_id": "…",
  "title": "Help Desk ticket: Daily sales report stuck",
  "body": "The report stayed queued after the connector action ran.",
  "data": { "conversationId": "...", "priority": "high", "source": "helpdesk" }
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
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Send data elsewhere"
        description="Whenever a customer leaves their details, books, or orders, we can push it straight into Slack, your CRM, or any other app — so you are not copying it across by hand. Setting one up needs a web address from the other app."
      />

      {/* Usage / limits (server-cost control) */}
      <Card>
        <CardHeader>
          <CardTitle>Your usage this month</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <div className="text-muted-foreground">Messages sent on</div>
              <div className="text-lg font-semibold">
                {usage.used.toLocaleString()}
                {monthlyLimit ? ` / ${monthlyLimit.toLocaleString()}` : ' / unlimited'}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Destinations set up</div>
              <div className="text-lg font-semibold">
                {usage.endpointCount} / {usage.limits.maxEndpoints}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Plan</div>
              {/* `capitalize` on a raw key printed "Free_trial"; the map has the
                  name the plan is actually sold under. */}
              <div className="text-lg font-semibold">
                {labelFor(PLAN_LABELS, usage.plan ?? 'trial')}
              </div>
            </div>
          </div>
          {monthlyLimit ? (
            <Progress
              value={pct}
              tone={pct >= 100 ? 'danger' : 'primary'}
              label="Webhook deliveries used this month"
            />
          ) : null}
          <p className="text-xs text-muted-foreground">
            One event sent to one destination counts as one message. Once you pass the monthly
            figure we stop sending until next month or until you upgrade, and every skipped one is
            listed below. Anything that fails is tried once more.
          </p>
        </CardContent>
      </Card>

      {/* Add endpoint */}
      <Card>
        <CardHeader>
          <CardTitle>Add a destination</CardTitle>
        </CardHeader>
        <CardContent>
          <WebhookForm atLimit={atEndpointLimit} />
        </CardContent>
      </Card>

      {/* Existing endpoints */}
      <Card>
        <CardHeader>
          <CardTitle>Where your data goes</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {endpoints.length === 0 ? (
            <EmptyState
              title="Nothing set up yet"
              body="Add a destination and every new enquiry, booking and order is copied into that app the moment it happens, so nobody has to retype it."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Destination</TableHead>
                  <TableHead>What we send</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last sent</TableHead>
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
                      <div className="break-all text-xs text-muted-foreground">{ep.urlPreview}</div>
                      {ep.secret ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Signing secret: <code className="rounded bg-muted px-1">{ep.secret}</code>
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      <ul className="space-y-0.5">
                        {ep.events.map((event) => (
                          <li key={event}>{WEBHOOK_EVENT_LABELS[event] ?? humanizeToken(event)}</li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ep.active ? 'success' : 'outline'}>
                        {ep.active ? 'On' : 'Paused'}
                      </Badge>
                      {ep.lastStatus ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Last attempt: {labelFor(DELIVERY_STATUS_LABELS, ep.lastStatus)}
                          {ep.failureCount > 0 ? ` — ${ep.failureCount} failed in a row` : ''}
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
                          <ConfirmSubmit
                            label="Delete"
                            question="This endpoint stops receiving events."
                          />
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
          <CardTitle>Recently sent</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {deliveries.length === 0 ? (
            <EmptyState
              title="Nothing sent yet"
              body="Once a destination is set up, every attempt appears here with what the other app answered — so if something is not arriving you can see why."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>What happened</TableHead>
                  <TableHead>Did we send it</TableHead>
                  <TableHead>What they answered</TableHead>
                  <TableHead>Tries</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-xs">
                      {WEBHOOK_EVENT_LABELS[d.event] ?? humanizeToken(d.event)}
                    </TableCell>
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
                        {labelFor(DELIVERY_STATUS_LABELS, d.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{outcomeFromCode(d.statusCode)}</TableCell>
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
            {/* Module 21 (RTL): `ms-5` keeps the bullet indent on the reading-start
                edge; `ms-5` would indent from the wrong side and clip the markers. */}
            <ul className="ms-5 list-disc text-muted-foreground">
              <li>
                <code>lead.created</code> — a new lead is captured
              </li>
              <li>
                <code>appointment.created</code> — a new appointment request
              </li>
              <li>
                <code>order.created</code> — a new order is placed via chat
              </li>
              <li>
                <code>ticket.created</code> - a customer or Help Desk ticket needs attention
              </li>
              <li>
                <code>ticket.resolved</code> - a ticket was marked resolved
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
              Every generic webhook is signed with HMAC-SHA256 using your endpoint&apos;s signing
              secret (shown next to the endpoint above). Recompute it and compare:
            </p>
            <pre className={codeBlock}>{VERIFY_EXAMPLE}</pre>
          </div>

          <div>
            <h3 className="font-medium">4. Connect Slack</h3>
            {/* Module 21 (RTL): these are verbatim menu paths in Slack's / Zapier's own
                English UI, so they are isolated with dir="ltr" rather than mirrored like
                the back-link arrows. The "→" here means "then click", reading with the
                Latin labels either side of it — flipping it would contradict the LTR run
                the bidi algorithm keeps them in, and dir="ltr" also stops the trailing
                comma and quote marks from being dragged to the wrong end of the phrase. */}
            <p className="text-muted-foreground">
              In Slack: <em dir="ltr">Apps → Incoming Webhooks → Add to a channel</em>, copy the
              URL, then add it here as a <strong>Slack</strong> webhook. You&apos;ll get a message
              in that channel for each event you choose.
            </p>
          </div>

          <div>
            <h3 className="font-medium">5. Connect 5,000+ apps (Zapier / Make)</h3>
            <p className="text-muted-foreground">
              In Zapier or Make create a trigger of type{' '}
              <em dir="ltr">&quot;Webhooks → Catch Hook&quot;</em>, copy the URL it gives you, and
              add it here as a <strong>Generic</strong> webhook. From there you can send
              leads/orders to Google Sheets, HubSpot, Salesforce, Mailchimp, and more — no coding.
            </p>
          </div>

          <div>
            <h3 className="font-medium">6. Limits</h3>
            <p className="text-muted-foreground">
              Your plan includes a monthly delivery budget and a maximum number of endpoints (shown
              at the top). This keeps the service fast and fair. Need more? Upgrade your plan or
              contact us for a custom limit.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
