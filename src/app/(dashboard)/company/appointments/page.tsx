import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES, APPOINTMENT_STATUS_LABELS, labelFor } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { listAppointmentsPaged } from '@/modules/company/appointments-data';
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

function statusVariant(status: string): BadgeVariant {
  if (status === 'requested') return 'default';
  if (status === 'confirmed') return 'success';
  if (status === 'completed') return 'secondary';
  if (status === 'cancelled') return 'destructive';
  return 'outline';
}

function dateTime(date: string | null, time: string | null): string {
  const d = date ? formatDate(date) : '—';
  return time ? `${d} · ${time}` : d;
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

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <RefreshOnFocus />
      <PageHeader
        title="Bookings"
        description="Everyone who has asked for an appointment through your assistant. Nothing is confirmed until you say so."
      />

      <div className="px-1">
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
      </div>

      <Card>
        <CardContent className="p-0">
          {appointments.length === 0 && filtered ? (
            // Module 1 — a filter is hiding everything, so offer the way back.
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
            // Module 2 — no requests yet; bookings start with a bookable service.
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Preferred</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {appointments.map((appt) => (
                  <TableRow key={appt.id}>
                    <TableCell>
                      <div className="font-medium">{appt.customerName || '—'}</div>
                      <div className="text-xs text-muted-foreground">
                        {appt.customerPhone ?? appt.customerEmail ?? ''}
                      </div>
                    </TableCell>
                    <TableCell>{appt.serviceType ?? '—'}</TableCell>
                    <TableCell>{dateTime(appt.preferredDate, appt.preferredTime)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(appt.status)}>
                        {labelFor(APPOINTMENT_STATUS_LABELS, appt.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(appt.createdAt)}</TableCell>
                    <TableCell>
                      <form action={setAppointmentStatusAction} className="flex items-center gap-2">
                        <input type="hidden" name="appointmentId" value={appt.id} />
                        {/* One control per row, so the accessible name has to
                            name the row too — a screen reader hearing "Booking
                            status" twenty times cannot tell whose it is. */}
                        <Select
                          name="status"
                          size="sm"
                          defaultValue={appt.status}
                          aria-label={`Booking status for ${appt.customerName || 'this customer'}`}
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
                          aria-label={`Save booking status for ${appt.customerName || 'this customer'}`}
                        >
                          Save status
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
