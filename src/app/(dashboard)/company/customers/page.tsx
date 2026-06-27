import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatDate } from '@/lib/format';
import { listAppointments } from '@/modules/company/appointments-data';
import { listLeads } from '@/modules/company/leads-data';
import { listChatOrders, listSyncedOrders } from '@/modules/company/orders-data';

function CountCard({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="block">
      <Card className="transition-colors hover:bg-muted/50">
        <CardContent className="p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

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
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Leads, appointment requests, and orders in one customer workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="#leads">Leads</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="#appointments">Appointments</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="#orders">Orders</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <CountCard label="Leads" value={leads.length} href="#leads" />
        <CountCard label="Appointments" value={appointments.length} href="#appointments" />
        <CountCard label="Orders" value={chatOrders.length + syncedOrders.length} href="#orders" />
      </div>

      <Card id="leads">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recent leads</CardTitle>
          <Link href="/company/leads" className="text-sm text-primary hover:underline">Manage all</Link>
        </CardHeader>
        <CardContent>
          {leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leads yet.</p>
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
                    <TableCell><Badge variant="secondary">{lead.status}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(lead.createdAt)}</TableCell>
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
          <Link href="/company/appointments" className="text-sm text-primary hover:underline">Manage all</Link>
        </CardHeader>
        <CardContent>
          {appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No appointment requests yet.</p>
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
                    <TableCell className="font-medium">{appointment.customerName || 'Customer'}</TableCell>
                    <TableCell>{appointment.serviceType ?? '-'}</TableCell>
                    <TableCell>
                      {[appointment.preferredDate, appointment.preferredTime].filter(Boolean).join(' ') || '-'}
                    </TableCell>
                    <TableCell><Badge variant="secondary">{appointment.status}</Badge></TableCell>
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
          <Link href="/company/orders" className="text-sm text-primary hover:underline">Manage all</Link>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
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
                    <TableCell className="font-medium">{order.customerName ?? 'Customer'}</TableCell>
                    <TableCell><Badge variant="secondary">{order.status ?? 'unknown'}</Badge></TableCell>
                    <TableCell>{formatCurrency(order.total, order.currency)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(order.createdAt)}</TableCell>
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
