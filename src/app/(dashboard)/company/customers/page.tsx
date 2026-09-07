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
import { formatCurrency, formatDate } from '@/lib/format';
import {
  CUSTOMER_TABS,
  getCustomerOverview,
  normalizeCustomerTab,
} from '@/modules/company/customers-data';
import { RefreshOnFocus } from '@/components/refresh-on-focus';

/**
 * Customers.
 *
 * What changed and why:
 *  - One list at a time. Three previews used to sit stacked, so the page was
 *    three near-identical tables tall and the buttons at the top only scrolled
 *    you down to them. With real volume that is a page nobody reads.
 *  - The counts on the tabs are the real totals, so "Enquiries 412" is visible
 *    without loading 412 rows — only the eight on screen are fetched.
 *  - Every row is a link to the thing it describes, rather than a dead cell.
 */

export const dynamic = 'force-dynamic';

const PREVIEW_SIZE = 8;

function tabHref(key: string): string {
  return key === 'leads' ? '/company/customers' : `/company/customers?show=${key}`;
}

export default async function CustomersWorkspacePage({
  searchParams,
}: {
  searchParams?: { show?: string };
}) {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const tab = normalizeCustomerTab(searchParams?.show);
  const overview = await getCustomerOverview(tab, PREVIEW_SIZE);
  // `normalizeCustomerTab` only ever returns a key that exists in the list, so
  // the fallback is for the type checker rather than a case that can happen.
  const active = CUSTOMER_TABS.find((t) => t.key === tab) ?? {
    key: 'leads' as const,
    label: 'Enquiries',
    href: '/company/leads',
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <RefreshOnFocus />
      <PageHeader
        title="Customers"
        description="Everyone who has been in touch — who left their details, who asked to book, and who ordered."
      />

      {/* The tabs carry the totals, so they are the summary as well as the
          navigation. Separate count tiles above them would say the same thing
          twice. */}
      <nav aria-label="Which customers to show" className="flex flex-wrap gap-2">
        {CUSTOMER_TABS.map(({ key, label }) => {
          const isActive = key === tab;
          const count = overview.counts[key];
          return (
            <Link
              key={key}
              href={tabHref(key)}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
                isActive ? 'border-primary bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/50',
              ].join(' ')}
            >
              <span>{label}</span>
              <span className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums">{count}</span>
            </Link>
          );
        })}
      </nav>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>
              {overview.counts[tab] > PREVIEW_SIZE
                ? `Latest ${PREVIEW_SIZE} of ${overview.counts[tab]}`
                : active.label}
            </CardTitle>
            <CardDescription>Newest first.</CardDescription>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={active.href}>Open all {active.label.toLowerCase()}</Link>
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          {tab === 'leads' ? (
            overview.leads.length === 0 ? (
              <EmptyState
                title="No enquiries yet"
                body="Once the chat is live on your website, anyone who leaves a name and a way to reach them appears here."
                action={
                  <Button asChild size="sm">
                    <Link href="/company/widget">Put the chat on your website</Link>
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>What they wanted</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.leads.map((lead) => (
                    <TableRow key={lead.id}>
                      <TableCell className="font-medium">{lead.name}</TableCell>
                      <TableCell>{lead.contact ?? '—'}</TableCell>
                      <TableCell>{lead.need ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{labelFor(LEAD_STATUS_LABELS, lead.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(lead.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : null}

          {tab === 'appointments' ? (
            overview.appointments.length === 0 ? (
              <EmptyState
                title="No booking requests yet"
                body="Mark one of your services as bookable and the assistant can take requests in chat."
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href="/company/business-data?tab=services">Make a service bookable</Link>
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>When they asked for</TableHead>
                    <TableHead>Stage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.appointments.map((appointment) => (
                    <TableRow key={appointment.id}>
                      <TableCell className="font-medium">{appointment.customerName}</TableCell>
                      <TableCell>{appointment.serviceType ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {appointment.preferredDate
                          ? `${formatDate(appointment.preferredDate)}${appointment.preferredTime ? ` at ${appointment.preferredTime}` : ''}`
                          : 'No time given'}
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
            )
          ) : null}

          {tab === 'orders' ? (
            overview.orders.length === 0 ? (
              <EmptyState
                title="No orders yet"
                body="Orders placed in chat appear here, and so do orders from your shop once you connect it."
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href="/company/integrations">Connect your shop</Link>
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Came from</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.orders.map((order) => (
                    <TableRow key={`${order.origin}-${order.id}`}>
                      <TableCell className="font-medium">{order.customerName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {order.origin === 'chat' ? 'Chat' : 'Your shop'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{labelFor(ORDER_STATUS_LABELS, order.status)}</Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatCurrency(order.total, order.currency)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(order.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
