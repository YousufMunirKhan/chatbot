import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { listAppointmentsPaged } from '@/modules/company/appointments-data';
import { setAppointmentStatusAction } from '@/modules/company/appointments-actions';
import { ListFilters, Pagination } from '@/modules/company/components/list-controls';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

const APPOINTMENT_STATUSES = ['requested', 'confirmed', 'cancelled', 'completed', 'no_show'] as const;

const selectCls =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Appointments</h1>
        <p className="text-sm text-muted-foreground">
          Booking and appointment requests from your assistant.
        </p>
      </div>

      <div className="px-1">
        <ListFilters
          basePath="/company/appointments"
          search={search}
          status={status}
          statuses={APPOINTMENT_STATUSES}
          placeholder="Search name, email, phone…"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {appointments.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {search || status !== 'all'
                ? 'No appointments match your filters.'
                : 'No appointment requests yet.'}
            </p>
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
                      <Badge variant={statusVariant(appt.status)}>{appt.status.replace(/_/g, ' ')}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(appt.createdAt)}</TableCell>
                    <TableCell>
                      <form action={setAppointmentStatusAction} className="flex items-center gap-2">
                        <input type="hidden" name="appointmentId" value={appt.id} />
                        <select name="status" defaultValue={appt.status} className={selectCls}>
                          {APPOINTMENT_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s.replace(/_/g, ' ')}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" variant="outline" size="sm">
                          Update
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
