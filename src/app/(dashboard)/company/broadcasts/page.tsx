import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { BROADCAST_STATUS_LABELS, CHANNEL_LABELS, ROLES, labelFor } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { formatDate } from '@/lib/format';
import { listApprovedTemplateOptions, listBroadcasts } from '@/modules/company/broadcasts-data';
import { deleteBroadcastAction } from '@/modules/company/broadcasts-actions';
import { BroadcastForm } from '@/modules/company/components/broadcast-form';
import { ConfirmSubmit } from '@/components/confirm-submit';

async function cancel(formData: FormData) {
  'use server';
  await deleteBroadcastAction(formData);
}

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' {
  if (status === 'sent') return 'success';
  if (status === 'failed') return 'destructive';
  if (status === 'sending') return 'warning';
  return 'secondary';
}

/** Plain-English label for a stored audience + its jsonb filter. */
function audienceLabel(audience: string, filter: Record<string, unknown>): string {
  switch (audience) {
    case 'opted_in':
      return 'Opted-in contacts';
    case 'tag':
      return `Tagged "${String(filter.tag ?? '')}"`;
    case 'segment':
      return `Status: ${String(filter.status ?? '')}`;
    case 'custom': {
      const n = Array.isArray(filter.contacts) ? filter.contacts.length : 0;
      return `${n} pasted contact${n === 1 ? '' : 's'}`;
    }
    default:
      return 'All leads';
  }
}

export default async function BroadcastsPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [broadcasts, templates] = await Promise.all([
    listBroadcasts(),
    listApprovedTemplateOptions(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Bulk messages"
        description={
          <>
            One message to a lot of customers at once, by WhatsApp or email — an offer, an opening,
            a closure. You need a connected{' '}
            <Link href="/company/channels" className="text-primary hover:underline">
              messaging app
            </Link>{' '}
            before you can send one.
          </>
        }
      />

      {/* Desktop: what you have already sent on the left, the composer on the
          right. They were stacked, so the list you came to check sat below a
          form you had already used. `min-w-0` on the children because a long
          message line in a `1fr` track stretches it and pushes the page
          sideways. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-0">
              {broadcasts.length === 0 ? (
                // Module 1 — the compose form is on this page, so link straight to it.
                <EmptyState
                  title="You have not sent a bulk message yet"
                  body="Send one WhatsApp or email to every lead with a matching contact detail. Sent and scheduled broadcasts stay on this list with their delivery count."
                  action={
                    <Button asChild size="sm">
                      <a href="#new-broadcast">Write a broadcast</a>
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y">
                  {broadcasts.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{labelFor(CHANNEL_LABELS, b.channel)}</Badge>
                          <Badge variant={statusVariant(b.status)}>
                            {labelFor(BROADCAST_STATUS_LABELS, b.status)}
                          </Badge>
                          <Badge variant="secondary">
                            {audienceLabel(b.audience, b.audienceFilter)}
                          </Badge>
                          {b.templateName ? (
                            <Badge variant="outline">
                              template: {b.templateName}
                              {b.templateLanguage ? ` (${b.templateLanguage})` : ''}
                            </Badge>
                          ) : null}
                          {b.status === 'sent' ? (
                            <span className="text-xs text-muted-foreground">
                              {b.sentCount} sent
                              {b.failedCount > 0 ? `, ${b.failedCount} failed` : ''}
                            </span>
                          ) : null}
                        </div>
                        {b.subject ? <p className="mt-1 font-medium">{b.subject}</p> : null}
                        <p className="mt-0.5 text-sm text-muted-foreground">{b.message}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {b.scheduleAt
                            ? `Scheduled ${formatDate(b.scheduleAt)}`
                            : 'Sends on next run'}
                        </p>
                      </div>
                      {b.status === 'scheduled' ? (
                        <form action={cancel}>
                          <input type="hidden" name="id" value={b.id} />
                          <ConfirmSubmit
                            label="Cancel this send"
                            confirmLabel="Yes, cancel it"
                            question="Nobody on this list will receive the message. Anyone it already reached keeps it."
                          />
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sticky on desktop: you write the next one while reading what the
            last one said, so the composer must not scroll away with the list. */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card id="new-broadcast">
            <CardHeader>
              <CardTitle>Write a new one</CardTitle>
              <CardDescription>
                Dispatched by the scheduled job. WhatsApp only delivers free-form text inside 24
                hours of the customer&apos;s last message — pick an{' '}
                <Link href="/company/whatsapp/templates" className="text-primary hover:underline">
                  approved template
                </Link>{' '}
                to reach everyone else.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BroadcastForm templates={templates} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
