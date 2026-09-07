import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import {
  ROLES,
  APPOINTMENT_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  labelFor,
} from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatDate } from '@/lib/format';
import { listAppointments } from '@/modules/company/appointments-data';
import { listLeads } from '@/modules/company/leads-data';
import { listChatOrders, listSyncedOrders } from '@/modules/company/orders-data';
import { RefreshOnFocus } from '@/components/refresh-on-focus';

export default async function CustomersWorkspacePage() {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const [leads, appointments, chatOrders, syncedOrders] = await Promise.all([
    listLeads(),
    listAppointments(),
    listChatOrders(),
    listSyncedOrders(),
  ]);
  const orders = [...chatOrders, ...syncedOrders].slice(0, 8);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <RefreshOnFocus />
      <PageHeader
        title="Customers"
        description="Everyone who has been in touch — who left their details, who asked to book, and who ordered. The three sections below each have a full page behind them."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="#leads">Leads</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="#appointments">Appointments</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="#orders">Orders</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Leads" value={leads.length} href="#leads" />
        <StatTile label="Appointments" value={appointments.length} href="#appointments" />
        <StatTile label="Orders" value={chatOrders.length + syncedOrders.length} href="#orders" />
      </div>

      <Card id="leads">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recent leads</CardTitle>
          <Link href="/company/leads" className="text-sm text-primary hover:underline">
            Manage all
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {leads.length === 0 ? (
            // Module 1 — nothing captured yet; the widget is what starts the flow.
            <EmptyState
              title="No leads yet."
              body="Once the widget is live, anyone who leaves a name and contact detail in chat appears here."
              action={
                <Button asChild size="sm">
                  <Link href="/company/widget">Install the widget</Link>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Need</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.slice(0, 8).map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell className="font-medium">{lead.name || 'Lead'}</TableCell>
                    <TableCell>{lead.email ?? lead.phone ?? '-'}</TableCell>
                    <TableCell>{lead.enquiryType ?? '-'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{labelFor(LEAD_STATUS_LABELS, lead.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(lead.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card id="appointments">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Appointment requests</CardTitle>
          <Link href="/company/appointments" className="text-sm text-primary hover:underline">
            Manage all
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {appointments.length === 0 ? (
            // Module 2 — bookings need a bookable service before they can arrive.
            <EmptyState
              title="No appointment requests yet."
              body="Mark a service as bookable and the assistant can take requests in chat."
              action={
                <Button asChild size="sm" variant="outline">
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
                  <TableHead>Preferred time</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {appointments.slice(0, 8).map((appointment) => (
                  <TableRow key={appointment.id}>
                    <TableCell className="font-medium">
                      {appointment.customerName || 'Customer'}
                    </TableCell>
                    <TableCell>{appointment.serviceType ?? '-'}</TableCell>
                    <TableCell>
                      {[appointment.preferredDate, appointment.preferredTime]
                        .filter(Boolean)
                        .join(' ') || '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {labelFor(APPOINTMENT_STATUS_LABELS, appointment.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card id="orders">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recent orders</CardTitle>
          <Link href="/company/orders" className="text-sm text-primary hover:underline">
            Manage all
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {orders.length === 0 ? (
            // Module 3 — covers both chat orders and store-synced orders.
            <EmptyState
              title="No orders yet."
              body="Orders placed in chat show up here, and so do orders from a connected store once you link one."
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href="/company/integrations">Connect a store</Link>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">
                      {order.customerName ?? 'Customer'}
                    </TableCell>
                    <TableCell>
                      {/* This row mixes chat orders with store-synced ones, so the
                          status can be a WooCommerce token we never chose. */}
                      <Badge variant="secondary">
                        {labelFor(ORDER_STATUS_LABELS, order.status, 'Not known')}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(order.total, order.currency)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(order.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
