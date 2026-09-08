import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES, APPOINTMENT_STATUS_LABELS, labelFor } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { formatDate } from '@/lib/format';
import { listAppointmentsPaged, type AppointmentRow } from '@/modules/company/appointments-data';
import { setAppointmentStatusAction } from '@/modules/company/appointments-actions';
import { ListFilters, Pagination } from '@/modules/company/components/list-controls';
import { RefreshOnFocus } from '@/components/refresh-on-focus';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

const APPOINTMENT_STATUSES = [
  'requested',
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
] as const;

/**
 * Bookings.
 *
 * WHY THIS IS A LIST OF ROWS AND NOT A TABLE
 * Six columns, the last one holding a `<Select>` and a Save button, is about
 * 700px of table. At 375px it scrolled sideways inside its card and hid the two
 * things the page exists for: the day the customer asked for, and the control
 * that confirms it. This is the row shape `/company/leads` and `/company/orders`
 * use — identity and what they want on the left, everything you act on in a
 * fixed 20rem column on the right from `lg` up — because Enquiries, Bookings
 * and Orders are the three lists behind `/company/customers` and an owner moves
 * between them all morning.
 *
 * Two things the table never showed at all, both already in the query:
 * `notes` — what the customer actually wrote when they asked — and the second
 * of their two contact details. The old cell printed `phone ?? email`, so a
 * booking with both showed only the phone.
 */
function statusVariant(status: string): BadgeVariant {
  if (status === 'requested') return 'default';
  if (status === 'confirmed') return 'success';
  if (status === 'completed') return 'secondary';
  if (status === 'cancelled') return 'destructive';
  return 'outline';
}

/** What they asked for, as a sentence rather than two possibly-empty cells. */
function preferredLabel(appt: AppointmentRow): string {
  if (!appt.preferredDate) {
    return appt.preferredTime ? `${appt.preferredTime} — no day given` : 'no day or time given';
  }
  const day = formatDate(appt.preferredDate);
  return appt.preferredTime ? `${day} at ${appt.preferredTime}` : day;
}

function BookingRow({ appt }: { appt: AppointmentRow }) {
  const who = appt.customerName || 'Someone who left no name';
  const statusId = `booking-status-${appt.id}`;
  return (
    <li className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">{who}</p>
            <p className="text-xs text-muted-foreground">
              Asked {formatDate(appt.createdAt)}
              {appt.serviceType ? ` · ${appt.serviceType}` : ''}
            </p>
          </div>
          <Badge variant={statusVariant(appt.status)} className="lg:hidden">
            {labelFor(APPOINTMENT_STATUS_LABELS, appt.status)}
          </Badge>
        </div>

        <p className="text-sm">
          <span className="text-muted-foreground">Wants </span>
          <span className="font-medium">{preferredLabel(appt)}</span>
        </p>

        {/* What they wrote when they asked. The table dropped this column
            entirely, though the query has always returned it. */}
        {appt.notes ? (
          <p className="line-clamp-3 rounded-md bg-muted/40 p-2 text-sm text-muted-foreground">
            {appt.notes}
          </p>
        ) : null}
      </div>

      <div className="space-y-3 lg:border-s lg:ps-4">
        <div className="hidden lg:block">
          <Badge variant={statusVariant(appt.status)}>
            {labelFor(APPOINTMENT_STATUS_LABELS, appt.status)}
          </Badge>
        </div>

        <div className="space-y-1 text-sm">
          {appt.customerPhone ? <p className="tabular-nums">{appt.customerPhone}</p> : null}
          {appt.customerEmail ? <p className="truncate">{appt.customerEmail}</p> : null}
          {!appt.customerPhone && !appt.customerEmail ? (
            <p className="text-muted-foreground">
              No contact details — you cannot confirm this one back to them.
            </p>
          ) : null}
        </div>

        <form action={setAppointmentStatusAction} className="space-y-1.5">
          <input type="hidden" name="appointmentId" value={appt.id} />
          {/* A visible per-row label, as on Enquiries: the control repeats down
              the list, so its accessible name has to come from something the
              reader can see. The Save button names the customer because its own
              text is identical in every row. */}
          <Label htmlFor={statusId} className="block text-xs text-muted-foreground">
            Where this booking stands
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              id={statusId}
              name="status"
              size="sm"
              defaultValue={appt.status}
              // `w-auto` so it sizes to its options rather than stretching the
              // column; `max-w-full` so the longest option ("Asked for — not
              // confirmed") cannot push the row past 375px.
              className="w-auto max-w-full"
            >
              {APPOINTMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {labelFor(APPOINTMENT_STATUS_LABELS, s)}
                </option>
              ))}
            </Select>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              aria-label={`Save booking status for ${who}`}
            >
              Save status
            </Button>
          </div>
        </form>
      </div>
    </li>
  );
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams?: { q?: string; status?: string; page?: string };
}) {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const search = searchParams?.q?.trim() || undefined;
  const status = searchParams?.status || 'all';
  const page = Number(searchParams?.page) || 1;
  const {
    rows: appointments,
    total,
    pageCount,
    pageSize,
  } = await listAppointmentsPaged({ page, search, status });
  const filtered = Boolean(search) || status !== 'all';
  const unconfirmed = appointments.filter((a) => a.status === 'requested').length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <RefreshOnFocus />
      <PageHeader
        title="Bookings"
        description="Everyone who has asked for an appointment through your assistant. Nothing is confirmed until you say so."
      />

      {/* The same standing line Enquiries carries, for the same reason: the
          count that decides whether this page is worth working through now. */}
      {unconfirmed > 0 ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{unconfirmed}</span> on this page
          {unconfirmed === 1 ? ' is' : ' are'} still waiting for you to confirm.
        </p>
      ) : null}

      <ListFilters
        basePath="/company/appointments"
        search={search}
        status={status}
        statuses={APPOINTMENT_STATUSES}
        statusLabels={APPOINTMENT_STATUS_LABELS}
        searchLabel="Search bookings"
        statusLabel="Booking status"
        placeholder="Search name, email, phone…"
      />

      <Card>
        <CardContent className="p-0">
          {appointments.length === 0 && filtered ? (
            // A filter is hiding everything, so offer the way back.
            <EmptyState
              title="No bookings match your filters"
              body={
                <>
                  Nothing matches {search ? <>&ldquo;{search}&rdquo;</> : 'this search'}
                  {status !== 'all' ? (
                    <>
                      {' '}
                      among bookings marked &ldquo;{labelFor(APPOINTMENT_STATUS_LABELS, status)}
                      &rdquo;
                    </>
                  ) : (
                    ''
                  )}
                  . Try a different word, or clear the filters to see every booking.
                </>
              }
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href="/company/appointments">Clear filters</Link>
                </Button>
              }
            />
          ) : appointments.length === 0 ? (
            // No requests yet; bookings start with a bookable service.
            <EmptyState
              title="No appointment requests yet"
              body={
                <>
                  Mark a service as bookable and the assistant can take requests in chat, with the
                  customer&rsquo;s preferred day and time.
                </>
              }
              action={
                <Button asChild size="sm">
                  <Link href="/company/business-data?tab=services">Set up a bookable service</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y">
              {appointments.map((appt) => (
                <BookingRow key={appt.id} appt={appt} />
              ))}
            </ul>
          )}
          {total > 0 && (
            <Pagination
              basePath="/company/appointments"
              page={page}
              pageCount={pageCount}
              total={total}
              pageSize={pageSize}
              search={search}
              status={status}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
