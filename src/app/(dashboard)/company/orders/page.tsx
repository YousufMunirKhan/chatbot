import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES, ORDER_STATUS_LABELS, ORDER_TYPE_LABELS, labelFor } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { listChatOrders, listSyncedOrders } from '@/modules/company/orders-data';
import { setChatOrderStatusAction } from '@/modules/company/orders-actions';
import { RefreshOnFocus } from '@/components/refresh-on-focus';

const CHAT_ORDER_STATUSES = ['pending', 'confirmed', 'paid', 'fulfilled', 'cancelled'] as const;

/**
 * Every status on this page is stored lowercase, and the synced half can carry
 * whatever the shop platform sends (WooCommerce prefixes its own with `wc-`).
 * `labelFor` maps the ones we know and prettifies the ones we do not, so the
 * owner never reads `wc-processing` in a badge.
 */
function statusVariant(status: string | null): 'success' | 'warning' | 'destructive' | 'secondary' {
  switch (status) {
    case 'paid':
    case 'fulfilled':
      return 'success';
    case 'pending':
    case 'confirmed':
      return 'warning';
    case 'cancelled':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export default async function OrdersPage() {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const [chatOrders, syncedOrders] = await Promise.all([listChatOrders(), listSyncedOrders()]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <RefreshOnFocus />
      <PageHeader
        title="Orders"
        description="Orders your customers placed in chat, plus the orders copied across from your connected shop."
      />

      <Card>
        <CardHeader>
          <CardTitle>Ordered in chat</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Placed by a customer talking to your assistant. You move each one along as you deal with
            it.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {chatOrders.length === 0 ? (
            // Module 1 — orders start in the widget, so send the owner to the catalog first.
            <EmptyState
              title="No chat orders yet."
              body="When a visitor places an order through the assistant, it lands here with its items and total, and you move it through to fulfilled."
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href="/company/catalog">Check your catalog</Link>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Update status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chatOrders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.customerName ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {labelFor(ORDER_TYPE_LABELS, o.orderType, '—')}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatNumber(o.itemCount)}</TableCell>
                    <TableCell>{formatCurrency(o.total, o.currency)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(o.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(o.status)}>
                        {labelFor(ORDER_STATUS_LABELS, o.status, 'Not started')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <form action={setChatOrderStatusAction} className="flex items-center gap-2">
                        <input type="hidden" name="orderId" value={o.id} />
                        {/* One control per row, so the accessible name has to
                            name the row too — a screen reader hearing "Order
                            status" twenty times cannot tell whose it is. */}
                        <Select
                          name="status"
                          size="sm"
                          defaultValue={o.status}
                          aria-label={`Order status for ${o.customerName ?? 'this customer'}`}
                        >
                          {CHAT_ORDER_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {labelFor(ORDER_STATUS_LABELS, s)}
                            </option>
                          ))}
                        </Select>
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          aria-label={`Save order status for ${o.customerName ?? 'this customer'}`}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>From your shop</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Copied across from Shopify or WooCommerce so the assistant can answer &ldquo;where is my
            order?&rdquo;. Change these in your shop, not here.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {syncedOrders.length === 0 ? (
            // Module 2 — nothing syncs until a store is connected.
            <EmptyState
              title="No synced orders yet."
              body={
                <>
                  Connect your WooCommerce or Shopify store and its orders copy across
                  automatically, so the assistant can answer &ldquo;where is my order&rdquo;.
                </>
              }
              action={
                <Button asChild size="sm">
                  <Link href="/company/integrations">Connect a store</Link>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {syncedOrders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.orderNumber ?? '—'}</TableCell>
                    <TableCell>{o.customerName ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(o.status)}>
                        {labelFor(ORDER_STATUS_LABELS, o.status, 'Not known')}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(o.total, o.currency)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(o.createdAt)}
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
