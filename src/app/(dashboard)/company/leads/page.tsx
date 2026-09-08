import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { LEAD_STATUS_LABELS, ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { formatRelativeTime, formatAbsoluteTime } from '@/lib/relative-time';
import { listLeadsPaged, type LeadRow } from '@/modules/company/leads-data';
import { LeadForm } from '@/modules/company/components/lead-form';
import { LeadStatusSelect } from '@/modules/company/components/lead-status-select';
import { ListFilters, Pagination } from '@/modules/company/components/list-controls';
import { RefreshOnFocus } from '@/components/refresh-on-focus';

/**
 * Enquiries.
 *
 * What changed and why:
 *  - The list comes first. "Add a lead" was a permanently expanded form above
 *    the table, so the thing the page is named after started below the fold.
 *    Adding someone you met by phone is the rare case; it now sits at the end.
 *  - Every enquiry can be acted on from the row: call, email or WhatsApp in one
 *    tap, and a link to the chat it came from. Previously the page could tell
 *    you a phone number existed but not let you use it, and never showed what
 *    the person had actually asked.
 *  - One interaction to change a stage, not a dropdown plus an Update button.
 *  - Seven columns became a readable card on a phone. A 7-column table at 375px
 *    is a horizontal scroll nobody performs.
 *  - Stages read as sentences ("Became a customer"), not enum values
 *    ("converted").
 */

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

/**
 * `open` is not a stored status — it is this list's resting view, and it means
 * every enquiry except the closed ones. Without it the page opened on all seven
 * of a shop's finished enquiries and read as seven outstanding ones. Closed work
 * is still one dropdown away, and `All statuses` still shows everything.
 */
const LEAD_STATUSES = ['open', 'new', 'contacted', 'qualified', 'converted', 'closed'] as const;
const DEFAULT_LEAD_STATUS = 'open';
const LEAD_FILTER_LABELS: Record<string, string> = {
  ...LEAD_STATUS_LABELS,
  open: 'Open — still needs action',
};

function statusVariant(status: string): BadgeVariant {
  if (status === 'new') return 'default';
  if (status === 'contacted') return 'secondary';
  if (status === 'qualified') return 'warning';
  if (status === 'converted') return 'success';
  return 'outline';
}

/** Digits only — `tel:` and `wa.me` both reject spaces and brackets. */
function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

function whatsappHref(phone: string): string {
  return `https://wa.me/${dialable(phone).replace(/^\+/, '')}`;
}

function ContactActions({ lead }: { lead: LeadRow }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {lead.phone ? (
        <>
          <Button asChild size="sm" variant="outline">
            <a href={`tel:${dialable(lead.phone)}`}>Call</a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={whatsappHref(lead.phone)} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          </Button>
        </>
      ) : null}
      {lead.email ? (
        <Button asChild size="sm" variant="outline">
          <a href={`mailto:${lead.email}`}>Email</a>
        </Button>
      ) : null}
      {lead.conversationId ? (
        <Button asChild size="sm" variant="ghost">
          <Link href={`/company/inbox/${lead.conversationId}`}>Read the chat</Link>
        </Button>
      ) : null}
    </div>
  );
}

/**
 * One enquiry.
 *
 * Stacked on a phone; on a wide screen the identity and what they asked sit on
 * the left and everything you act on — contact details, the buttons, the stage
 * — sits in a fixed right-hand column. That keeps the action controls in one
 * predictable place down the list instead of drifting with the message length,
 * and stops a 1440px screen rendering a narrow ribbon of cards.
 */
function LeadCard({ lead }: { lead: LeadRow }) {
  return (
    <li className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {/* `text-sm`, the body default: the same person's name renders at
                the same size in the inbox, on Bookings and on Orders. */}
            <p className="text-sm font-medium">{lead.name || 'Someone who left no name'}</p>
            <p className="text-xs text-muted-foreground" title={formatAbsoluteTime(lead.createdAt)}>
              {formatRelativeTime(lead.createdAt)}
              {lead.enquiryType ? ` · ${lead.enquiryType}` : ''}
            </p>
          </div>
          <Badge variant={statusVariant(lead.status)} className="lg:hidden">
            {LEAD_STATUS_LABELS[lead.status] ?? lead.status}
          </Badge>
        </div>

        {/* What they actually asked — the reason to call them back. */}
        {lead.message ? (
          <p className="line-clamp-3 rounded-md bg-muted/40 p-2 text-sm text-muted-foreground">
            {lead.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-3 lg:border-s lg:ps-4">
        <div className="hidden lg:block">
          <Badge variant={statusVariant(lead.status)}>
            {LEAD_STATUS_LABELS[lead.status] ?? lead.status}
          </Badge>
        </div>

        <div className="space-y-1 text-sm">
          {lead.phone ? <p className="tabular-nums">{lead.phone}</p> : null}
          {lead.email ? <p className="truncate">{lead.email}</p> : null}
          {!lead.phone && !lead.email ? (
            <p className="text-muted-foreground">No contact details — open the chat to see what happened.</p>
          ) : null}
        </div>

        <ContactActions lead={lead} />

        <div className="space-y-1.5">
          {/* The `Label` primitive, not a bare `<label>`: same wiring, and the
              per-row field labels on Bookings and Orders now read identically. */}
          <Label htmlFor={`stage-${lead.id}`} className="block text-xs text-muted-foreground">
            Where this has got to
          </Label>
          <LeadStatusSelect leadId={lead.id} status={lead.status} selectId={`stage-${lead.id}`} />
        </div>
      </div>
    </li>
  );
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: { q?: string; status?: string; page?: string };
}) {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const search = searchParams?.q?.trim() || undefined;
  const status = searchParams?.status || DEFAULT_LEAD_STATUS;
  const page = Number(searchParams?.page) || 1;
  const { rows: leads, total, pageCount, pageSize } = await listLeadsPaged({ page, search, status });
  const filtered = Boolean(search) || status !== DEFAULT_LEAD_STATUS;
  const waiting = leads.filter((l) => l.status === 'new').length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <RefreshOnFocus />
      <PageHeader
        title="Enquiries"
        description="Everyone who left their name and a way to reach them — collected by your assistant, or typed in by you."
        actions={
          <Button asChild variant="outline">
            <a href="/api/company/leads/export">Export CSV</a>
          </Button>
        }
      />

      {waiting > 0 ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{waiting}</span> on this page
          {waiting === 1 ? ' has' : ' have'} not been contacted yet.
        </p>
      ) : null}

      <ListFilters
        basePath="/company/leads"
        search={search}
        status={status}
        statuses={LEAD_STATUSES}
        statusLabels={LEAD_FILTER_LABELS}
        defaultStatus={DEFAULT_LEAD_STATUS}
        placeholder="Search name, email, phone…"
      />

      <Card>
        <CardContent className="p-0">
          {leads.length === 0 && filtered ? (
            <EmptyState
              title="Nothing matches those filters"
              body={
                <>
                  Nothing matches {search ? <>&ldquo;{search}&rdquo;</> : 'this search'}
                  {status !== DEFAULT_LEAD_STATUS
                    ? ` at the ${LEAD_FILTER_LABELS[status] ?? status} stage`
                    : ''}.
                </>
              }
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href="/company/leads">Clear filters</Link>
                </Button>
              }
            />
          ) : leads.length === 0 ? (
            <EmptyState
              title="No enquiries yet"
              body="When someone leaves their name and contact details in chat, they appear here — with what they asked, so you know why you are calling."
              action={
                <Button asChild size="sm">
                  <a href="#add-lead">Add someone manually</a>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y">
              {leads.map((lead) => (
                <LeadCard key={lead.id} lead={lead} />
              ))}
            </ul>
          )}

          {total > 0 && (
            <Pagination
              basePath="/company/leads"
              page={page}
              pageCount={pageCount}
              total={total}
              pageSize={pageSize}
              search={search}
              status={status}
              defaultStatus={DEFAULT_LEAD_STATUS}
            />
          )}
        </CardContent>
      </Card>

      {/* Last, not first: adding someone by hand is the exception. */}
      <Card id="add-lead">
        <CardHeader>
          <CardTitle>Add someone manually</CardTitle>
          <CardDescription>
            For a customer who called or walked in, so they sit alongside the ones your assistant collected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadForm />
        </CardContent>
      </Card>
    </div>
  );
}
