import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES, ORDER_STATUS_LABELS, ORDER_TYPE_LABELS, labelFor } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { listChatOrders, listSyncedOrders } from '@/modules/company/orders-data';
import { setChatOrderStatusAction } from '@/modules/company/orders-actions';
import { RefreshOnFocus } from '@/components/refresh-on-focus';

const CHAT_ORDER_STATUSES = ['pending', 'confirmed', 'paid', 'fulfilled', 'cancelled'] as const;

/**
 * Orders.
 *
 * WHY THIS IS A LIST OF ROWS AND NOT A TABLE
 * Both halves of this page used to be `<Table>`s — seven columns for chat
 * orders, five for synced ones — and the chat half carried a `<Select>` and a
 * Save button inside its last cell. At 375px that is roughly 700px of table
 * scrolling sideways inside its own card: the customer's name is visible and
 * the total, the status and the only control on the page are not. A shop owner
 * checking orders on a phone is the normal case, not the exceptional one.
 *
 * So each order is one row that reflows: identity and what was bought on the
 * left, and everything you act on — the status and the control that changes it
 * — in a fixed 20rem column on the right from `lg` up. That is the same shape
 * `/company/leads` already uses, which matters because Enquiries, Bookings and
 * Orders are the three lists behind `/company/customers` and a shop owner moves
 * between them all morning. One pattern, three screens.
 *
 * Every status is stored lowercase and the synced half can carry whatever the
 * shop platform sends (WooCommerce prefixes its own with `wc-`). `labelFor`
 * maps the ones we know and prettifies the rest, so the owner never reads
 * `wc-processing` in a badge.
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
          <CardDescription>
            Placed by a customer talking to your assistant. You move each one along as you deal with
            it.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {chatOrders.length === 0 ? (
            // Orders start in the widget, so send the owner to the catalog first.
            <EmptyState
              title="No chat orders yet"
              body="When a visitor places an order through the assistant, it lands here with its items and total, and you move it through to sent to the customer."
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href="/company/catalog">Check your catalog</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y">
              {chatOrders.map((o) => {
                const who = o.customerName ?? 'Someone who left no name';
                const statusId = `chat-order-status-${o.id}`;
                return (
                  <li key={o.id} className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{who}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(o.createdAt)}
                            {' · '}
                            {labelFor(ORDER_TYPE_LABELS, o.orderType, 'Order')}
                          </p>
                        </div>
                        {/* The badge rides beside the name until there is a
                            right-hand column to put it in. */}
                        <Badge variant={statusVariant(o.status)} className="lg:hidden">
                          {labelFor(ORDER_STATUS_LABELS, o.status, 'Not started')}
                        </Badge>
                      </div>
                      {/* The money is the reason this row is read, so it is the
                          largest thing in it and it never wraps mid-number. */}
                      <p className="text-sm">
                        <span className="font-medium tabular-nums">
                          {formatCurrency(o.total, o.currency)}
                        </span>
                        <span className="text-muted-foreground">
                          {' · '}
                          {formatNumber(o.itemCount)} {o.itemCount === 1 ? 'item' : 'items'}
                        </span>
                      </p>
                    </div>

                    <div className="space-y-3 lg:border-s lg:ps-4">
                      <div className="hidden lg:block">
                        <Badge variant={statusVariant(o.status)}>
                          {labelFor(ORDER_STATUS_LABELS, o.status, 'Not started')}
                        </Badge>
                      </div>
                      <form action={setChatOrderStatusAction} className="space-y-1.5">
                        <input type="hidden" name="orderId" value={o.id} />
                        {/* A visible per-row label, as on Enquiries: the
                            control repeats down the list, so the accessible
                            name has to come from something the reader can see,
                            and the Save button names the customer because its
                            own text is identical in every row. */}
                        <Label htmlFor={statusId} className="block text-xs text-muted-foreground">
                          Move this order on
                        </Label>
                        <div className="flex flex-wrap items-center gap-2">
                          <Select
                            id={statusId}
                            name="status"
                            size="sm"
                            defaultValue={o.status}
                            // `w-auto` so it sizes to its options rather than
                            // stretching the column; `max-w-full` so the
                            // longest option cannot push the row past 375px.
                            className="w-auto max-w-full"
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
                            aria-label={`Save order status for ${who}`}
                          >
                            Save status
                          </Button>
                        </div>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>From your shop</CardTitle>
          <CardDescription>
            Copied across from Shopify or WooCommerce so the assistant can answer &ldquo;where is my
            order?&rdquo;. Change these in your shop, not here.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {syncedOrders.length === 0 ? (
            // Nothing syncs until a store is connected.
            <EmptyState
              title="No synced orders yet"
              body="Connect your WooCommerce or Shopify store and its orders copy across automatically, so the assistant can answer “where is my order”."
              action={
                <Button asChild size="sm">
                  <Link href="/company/integrations">Connect a store</Link>
                </Button>
              }
            />
          ) : (
            /* Read-only, so no right-hand control column — but the same row
               shape, because two lists on one page rendered two different ways
               is the thing this pass exists to remove. */
            <ul className="divide-y">
              {syncedOrders.map((o) => (
                <li
                  key={o.id}
                  className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {o.orderNumber ? `#${o.orderNumber}` : 'Order'}
                      {o.customerName ? (
                        <span className="font-normal text-muted-foreground"> · {o.customerName}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDate(o.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant={statusVariant(o.status)}>
                      {labelFor(ORDER_STATUS_LABELS, o.status, 'Not known')}
                    </Badge>
                    <span className="text-sm font-medium tabular-nums">
                      {formatCurrency(o.total, o.currency)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
