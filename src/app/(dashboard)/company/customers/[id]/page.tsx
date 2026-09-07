import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import {
  APPOINTMENT_STATUS_LABELS,
  CHANNEL_LABELS,
  LEAD_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  ROLES,
  labelFor,
} from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { formatCurrency, formatDate } from '@/lib/format';
import { formatAbsoluteTime, formatDayGroup, formatRelativeTime } from '@/lib/relative-time';
import { getContactDetail, type ContactTimelineEntry } from '@/modules/contacts/contacts-data';
import { dialable, whatsappHref } from '@/modules/contacts/identity';
import {
  removeContactAttributeAction,
  removeContactTagAction,
} from '@/modules/contacts/contacts-actions';
import {
  ContactAddressForm,
  ContactAttributeForm,
  ContactNoteForm,
  ContactRenameForm,
  ContactTagForm,
} from '@/modules/contacts/components/contact-forms';
import { RefreshOnFocus } from '@/components/refresh-on-focus';

/**
 * One person.
 *
 * This is the page the product never had. Before it, answering "who is this and
 * what have we done for them" meant opening the enquiries list, the bookings
 * list, the orders list and the inbox, and matching rows by eye on a phone
 * number that was punctuated differently in each one.
 *
 * The order of the page is the order the questions get asked: who they are and
 * how to reach them, then what they have said (every channel, one thread), then
 * what they asked for, what they bought, and finally what the team knows about
 * them that no record holds.
 *
 * The timeline is the point of the whole thing, so it comes before the tables.
 * It is one list across every channel — the March email, the June WhatsApp
 * message and last week's web chat sit next to each other, in order, because to
 * the customer they were always one conversation.
 */

export const dynamic = 'force-dynamic';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'info' | 'destructive' | 'outline';

function leadStatusVariant(status: string): BadgeVariant {
  if (status === 'new') return 'default';
  if (status === 'contacted') return 'secondary';
  if (status === 'qualified') return 'warning';
  if (status === 'converted') return 'success';
  return 'outline';
}

function senderLabel(sender: ContactTimelineEntry['sender']): string {
  if (sender === 'ai') return 'Assistant';
  if (sender === 'agent') return 'Your team';
  if (sender === 'system') return 'System';
  return 'Them';
}

/** Markdown scaffolding an agent never asked to see. */
function displayMessage(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export default async function ContactPage({ params }: { params: { id: string } }) {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const contact = await getContactDetail(params.id);
  // A contact belonging to another company reads as null, so a guessed id is
  // indistinguishable from one that never existed.
  if (!contact) notFound();

  const phone = contact.phones[0];
  const email = contact.emails[0];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <RefreshOnFocus />
      <PageHeader
        backTo={{ href: '/company/customers', label: 'Customers' }}
        title={contact.name}
        description={
          <>
            First heard from{' '}
            <span title={formatAbsoluteTime(contact.firstSeenAt)}>
              {formatRelativeTime(contact.firstSeenAt)}
            </span>
            {' · last heard from '}
            <span title={formatAbsoluteTime(contact.lastSeenAt)}>
              {formatRelativeTime(contact.lastSeenAt)}
            </span>
          </>
        }
      />

      {/* Everything you might do about this person, before anything you might
          read. The buttons are the reason an agent opened the page. */}
      {phone || email ? (
        <div className="flex flex-wrap gap-2">
          {phone ? (
            <>
              <Button asChild size="sm" variant="outline">
                <a href={`tel:${dialable(phone)}`}>Call</a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={whatsappHref(phone)} target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              </Button>
            </>
          ) : null}
          {email ? (
            <Button asChild size="sm" variant="outline">
              <a href={`mailto:${email}`}>Email</a>
            </Button>
          ) : null}
        </div>
      ) : null}

      <Section
        title="Who they are"
        description="Any address here identifies this person. Adding one that already belongs to somebody else merges the two."
      >
        <ContactRenameForm contactId={contact.id} displayName={contact.displayName} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Email
            </p>
            {contact.emails.length ? (
              contact.emails.map((value) => (
                <p key={value} className="break-all text-sm">
                  {value}
                </p>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">None on file</p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Phone
            </p>
            {contact.phones.length ? (
              contact.phones.map((value) => (
                <p key={value} className="text-sm">
                  {value}
                </p>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">None on file</p>
            )}
          </div>
        </div>

        <ContactAddressForm contactId={contact.id} />
      </Section>

      <Section
        title="Tags and details"
        description="Anything you want to remember about them that no form asked for."
      >
        <div className="flex flex-wrap items-center gap-2">
          {contact.tags.length ? (
            contact.tags.map((tag) => (
              // A one-control form, so the remove button IS the form. No
              // client component, no dialog: removing a tag is not a decision
              // that needs confirming, and it takes two seconds to re-add.
              <form key={tag} action={removeContactTagAction} className="inline-flex">
                <input type="hidden" name="contactId" value={contact.id} />
                <input type="hidden" name="tag" value={tag} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground hover:bg-muted"
                  aria-label={`Remove the tag ${tag}`}
                >
                  {tag}
                  <span aria-hidden="true">×</span>
                </button>
              </form>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No tags yet.</p>
          )}
        </div>

        <ContactTagForm contactId={contact.id} />

        {contact.attributes.length ? (
          <dl className="divide-y rounded-md border">
            {contact.attributes.map((attribute) => (
              <div
                key={attribute.key}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <dt className="font-medium">{attribute.key}</dt>
                <dd className="flex items-center gap-3">
                  <span className="text-muted-foreground">{attribute.value || '—'}</span>
                  <form action={removeContactAttributeAction}>
                    <input type="hidden" name="contactId" value={contact.id} />
                    <input type="hidden" name="key" value={attribute.key} />
                    <button
                      type="submit"
                      className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      Remove
                    </button>
                  </form>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        <ContactAttributeForm contactId={contact.id} />
      </Section>

      <Section
        title="Everything they have said"
        description={
          contact.timelineTruncated
            ? 'The most recent messages, across every channel. Older ones are in the chats listed below.'
            : 'Every message, across every channel, oldest at the bottom.'
        }
      >
        {contact.timeline.length === 0 ? (
          <EmptyState
            title="Nothing sent yet"
            body="This person left their details but has not messaged. Anything they send on any channel appears here."
          />
        ) : (
          <ol className="space-y-3">
            {contact.timeline.map((entry) => (
              <li key={entry.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{senderLabel(entry.sender)}</span>
                  <Badge variant="outline">{labelFor(CHANNEL_LABELS, entry.channel)}</Badge>
                  <span title={formatAbsoluteTime(entry.at)}>
                    {formatDayGroup(entry.at)} · {formatRelativeTime(entry.at)}
                  </span>
                  <Link
                    href={`/company/inbox/${entry.conversationId}`}
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    Open the chat
                  </Link>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{displayMessage(entry.text)}</p>
              </li>
            ))}
          </ol>
        )}

        {contact.conversations.length ? (
          <div className="space-y-1 border-t pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Their chats
            </p>
            <ul className="flex flex-wrap gap-2">
              {contact.conversations.map((conversation) => (
                <li key={conversation.id}>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/company/inbox/${conversation.id}`}>
                      {labelFor(CHANNEL_LABELS, conversation.channel)} ·{' '}
                      {formatRelativeTime(conversation.lastMessageAt)}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <Section title="What they asked for" description="Their enquiries, newest first.">
        {contact.enquiries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No enquiries recorded.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {contact.enquiries.map((enquiry) => (
              <li key={enquiry.id} className="space-y-1 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {enquiry.enquiryType || 'Enquiry'}
                    {enquiry.source ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        via {enquiry.source.replace(/[._-]+/g, ' ')}
                      </span>
                    ) : null}
                  </p>
                  <Badge variant={leadStatusVariant(enquiry.status)}>
                    {labelFor(LEAD_STATUS_LABELS, enquiry.status)}
                  </Badge>
                </div>
                {enquiry.message ? (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {enquiry.message}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground" title={formatAbsoluteTime(enquiry.createdAt)}>
                  {formatRelativeTime(enquiry.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {contact.bookings.length ? (
        <Section title="What they booked">
          <ul className="divide-y rounded-md border">
            {contact.bookings.map((booking) => (
              <li key={booking.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <p className="text-sm font-medium">{booking.serviceType || 'Booking request'}</p>
                  <p className="text-xs text-muted-foreground">
                    {booking.preferredDate
                      ? `${formatDate(booking.preferredDate)}${booking.preferredTime ? ` at ${booking.preferredTime}` : ''}`
                      : 'No time given'}
                  </p>
                </div>
                <Badge variant="secondary">
                  {labelFor(APPOINTMENT_STATUS_LABELS, booking.status)}
                </Badge>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="What they bought" description="Orders placed in chat and orders from your shop.">
        {contact.orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders recorded.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {contact.orders.map((order) => (
              <li
                key={`${order.origin}-${order.id}`}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {order.reference ? `#${order.reference}` : 'Order'}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {order.origin === 'chat' ? 'Chat' : 'Your shop'}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground" title={formatAbsoluteTime(order.createdAt)}>
                    {formatRelativeTime(order.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">{labelFor(ORDER_STATUS_LABELS, order.status)}</Badge>
                  <span className="text-sm tabular-nums">
                    {formatCurrency(order.total, order.currency)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Notes" description="What your team knows that no record holds.">
        <ContactNoteForm contactId={contact.id} />
        {contact.notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          <ul className="space-y-2">
            {contact.notes.map((note) => (
              <li key={note.id} className="rounded-md border p-3">
                <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                <p className="mt-1 text-xs text-muted-foreground" title={formatAbsoluteTime(note.createdAt)}>
                  {note.authorName} · {formatRelativeTime(note.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
