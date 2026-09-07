import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import {
  ROLES,
  CHANNEL_LABELS,
  DELIVERY_STATUS_LABELS,
  PROVIDER_LABELS,
  humanizeToken,
  labelFor,
} from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { formatDate } from '@/lib/format';
import { EVENT_LABELS } from '@/lib/commerce/automation-templates';
import { STARTER_RULES } from '@/lib/commerce/starter-rules';
import {
  listAutomationRules,
  listAutomationRuns,
  listStoreWebhooks,
} from '@/modules/company/automations-data';
import {
  addStarterRuleAction,
  deleteAutomationRuleAction,
  issueStoreWebhookTokenAction,
  toggleAutomationRuleAction,
} from '@/modules/company/automations-actions';
import { AutomationForm } from '@/modules/company/components/automation-form';

async function addStarter(formData: FormData) {
  'use server';
  await addStarterRuleAction(formData);
}
async function toggle(formData: FormData) {
  'use server';
  await toggleAutomationRuleAction(formData);
}
async function remove(formData: FormData) {
  'use server';
  await deleteAutomationRuleAction(formData);
}
async function issueToken(formData: FormData) {
  'use server';
  await issueStoreWebhookTokenAction(formData);
}

/**
 * A run names the thing it fired about: `order` plus a UUID. The type is worth
 * showing (was it an order or a cart?); the UUID is our primary key and means
 * nothing to the owner, so only its short prefix is kept — enough to tell two
 * rows apart, without pretending to be a reference they can look up.
 */
function describeSubject(entityType: string, entityId: string | null | undefined): string {
  const subject = humanizeToken(entityType);
  if (!entityId) return subject;
  return `${subject} ${entityId.slice(0, 8)}`;
}

function runVariant(status: string): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (status === 'sent') return 'success';
  if (status === 'failed') return 'destructive';
  if (status === 'skipped') return 'warning';
  return 'secondary';
}

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams?: { edit?: string };
}) {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [rules, runs, webhooks] = await Promise.all([
    listAutomationRules(),
    listAutomationRuns(25),
    listStoreWebhooks(),
  ]);

  const editing = searchParams?.edit ? rules.find((r) => r.id === searchParams.edit) : undefined;
  const existingNames = new Set(rules.map((r) => r.name));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Automatic messages"
        description="Let your shop send the messages for you: a confirmation when an order comes in, a tracking link when it ships, a reminder when someone leaves a full basket. You write the wording once."
      />

      <Card>
        <CardHeader>
          <CardTitle>Start with one that already works</CardTitle>
          <CardDescription>
            One click sets it up and switches it on, with wording you can change afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {STARTER_RULES.map((starter) => {
            const added = existingNames.has(starter.name);
            return (
              <div
                key={starter.key}
                className="flex items-start justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{starter.name}</p>
                  <p className="text-sm text-muted-foreground">{starter.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {EVENT_LABELS[starter.triggerEvent]} · sent on{' '}
                    {labelFor(CHANNEL_LABELS, starter.channel)}
                    {starter.delayMinutes ? ` · after ${starter.delayMinutes} min` : ''}
                  </p>
                </div>
                {added ? (
                  <Badge variant="secondary">Added</Badge>
                ) : (
                  <form action={addStarter}>
                    <input type="hidden" name="key" value={starter.key} />
                    {/* One button per starter, so a bare "Add" gave a screen
                        reader four identical labels and gave everyone else no
                        idea which of the four they were about to switch on. */}
                    <Button type="submit" size="sm" variant="outline">
                      Use this one
                    </Button>
                  </form>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Desktop: your rules and what they actually sent on the left, the
          editor and the shop-webhook setup on the right. Stacked, the log
          that tells you whether any of this worked was four screens down. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Your automatic messages</CardTitle>
              <CardDescription>
                The counts below cover everything each one has ever sent.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {rules.length === 0 ? (
                <EmptyState
                  title="Nothing is sending automatically yet"
                  body="Add one of the ready-made ones above and your customers get their confirmation, their tracking link and their basket reminder without anybody typing a message."
                  action={
                    <Button asChild size="sm">
                      <a href="#new-automation">Write your own</a>
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y">
                  {rules.map((rule) => (
                    <li
                      key={rule.id}
                      className="flex flex-wrap items-start justify-between gap-3 p-4"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{rule.name}</span>
                          <Badge variant={rule.isActive ? 'success' : 'outline'}>
                            {rule.isActive ? 'On' : 'Paused'}
                          </Badge>
                          <Badge variant="outline">
                            {EVENT_LABELS[rule.triggerEvent] ?? rule.triggerEvent}
                          </Badge>
                          <Badge variant="outline">{labelFor(CHANNEL_LABELS, rule.channel)}</Badge>
                          {rule.delayMinutes > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              waits {rule.delayMinutes} minutes first
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">
                          {rule.messageTemplate}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {rule.sentCount} sent · {rule.pendingCount} waiting to send ·{' '}
                          {rule.failedCount} did not send ·{' '}
                          {rule.lastRunAt
                            ? `last one ${formatDate(rule.lastRunAt)}`
                            : 'has not sent anything yet'}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/company/automations?edit=${rule.id}#new-automation`}>
                            Edit
                          </Link>
                        </Button>
                        <form action={toggle}>
                          <input type="hidden" name="id" value={rule.id} />
                          <input type="hidden" name="active" value={(!rule.isActive).toString()} />
                          <Button type="submit" size="sm" variant="outline">
                            {rule.isActive ? 'Pause' : 'Activate'}
                          </Button>
                        </form>
                        <form action={remove}>
                          <input type="hidden" name="id" value={rule.id} />
                          <ConfirmSubmit
                            label="Delete"
                            question="Queued messages for this automation will not be sent."
                          />
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recently sent</CardTitle>
              <CardDescription>The last 25 messages these rules lined up to send.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {runs.length === 0 ? (
                <EmptyState
                  title="Nothing has run yet"
                  body="As soon as your shop reports its first order, or somebody leaves a full basket, it shows up here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rule</TableHead>
                      <TableHead>About</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due to send</TableHead>
                      <TableHead>What went wrong</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="font-medium">{run.ruleName}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {describeSubject(run.entityType, run.entityId)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={runVariant(run.status)}>
                            {labelFor(DELIVERY_STATUS_LABELS, run.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(run.scheduledFor)}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-muted-foreground">
                          {run.error ?? '—'}
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
          <Card id="new-automation">
            <CardHeader>
              <CardTitle>{editing ? `Edit “${editing.name}”` : 'Write your own'}</CardTitle>
              <CardDescription>
                {editing ? (
                  <Link href="/company/automations" className="text-primary hover:underline">
                    Cancel and create a new one instead
                  </Link>
                ) : (
                  'Messages are sent by the automation cron over your connected WhatsApp or email channel.'
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AutomationForm
                key={editing?.id ?? 'new'}
                rule={
                  editing
                    ? {
                        id: editing.id,
                        name: editing.name,
                        triggerEvent: editing.triggerEvent,
                        channel: editing.channel,
                        templateName: editing.templateName,
                        messageTemplate: editing.messageTemplate,
                        delayMinutes: editing.delayMinutes,
                        conditions: editing.conditions,
                        isActive: editing.isActive,
                      }
                    : undefined
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tell your shop where to send the news</CardTitle>
              <CardDescription>
                None of this can start until your shop tells us that an order happened. Copy the web
                address below and paste it into your shop&apos;s notification settings — in Shopify
                under <span dir="ltr">Settings → Notifications → Webhooks</span>, in WooCommerce
                under <span dir="ltr">Settings → Advanced → Webhooks</span> — for orders, shipping,
                cancellations and checkouts. It is a one-off job, and a good one to hand to whoever
                set your shop up.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {webhooks.length === 0 ? (
                <EmptyState
                  title="No shop connected yet"
                  body="Connect Shopify or WooCommerce first. Each shop gets its own web address, and we cannot make one until there is a shop to make it for."
                  action={
                    <Button asChild size="sm">
                      <Link href="/company/integrations">Connect a store</Link>
                    </Button>
                  }
                />
              ) : (
                webhooks.map((hook) => (
                  <div
                    key={hook.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {labelFor(PROVIDER_LABELS, hook.provider, hook.name)}
                      </p>
                      {hook.url ? (
                        <>
                          <p className="mt-2 text-xs font-medium text-muted-foreground">
                            Address
                          </p>
                          <code className="mt-1 block break-all rounded bg-muted px-1.5 py-1 text-xs">
                            {hook.url}
                          </code>
                          {/* Both halves matter. The address says which account a
                              webhook belongs to; the secret is what proves the
                              message really came from that shop. A shop set up
                              with only the address is unverified, and in
                              production the webhook is refused. */}
                          {hook.secret ? (
                            <>
                              <p className="mt-2 text-xs font-medium text-muted-foreground">
                                Secret — paste this into the same webhook screen in your shop
                              </p>
                              <code className="mt-1 block break-all rounded bg-muted px-1.5 py-1 text-xs">
                                {hook.secret}
                              </code>
                            </>
                          ) : (
                            <p className="mt-2 text-xs text-muted-foreground">
                              This address has no secret yet. Press the button to reissue both —
                              until then your shop&rsquo;s messages cannot be verified.
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No address yet — press the button to create one.
                        </p>
                      )}
                    </div>
                    <form action={issueToken}>
                      <input type="hidden" name="integrationId" value={hook.id} />
                      <Button type="submit" size="sm" variant="outline">
                        {hook.url ? 'Replace this address' : 'Create the address'}
                      </Button>
                    </form>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
