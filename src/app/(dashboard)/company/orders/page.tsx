import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const CHAT_ORDER_STATUSES = ['pending', 'confirmed', 'paid', 'fulfilled', 'cancelled'] as const;

const selectCls =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="text-sm text-muted-foreground">
          Conversational orders placed by your assistants and orders synced from connected stores.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Chat orders</CardTitle>
        </CardHeader>
        <CardContent>
          {chatOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No chat orders yet.</p>
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
                      <Badge variant="outline">{o.orderType}</Badge>
                    </TableCell>
                    <TableCell>{formatNumber(o.itemCount)}</TableCell>
                    <TableCell>{formatCurrency(o.total, o.currency)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(o.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(o.status)}>{o.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <form action={setChatOrderStatusAction} className="flex items-center gap-2">
                        <input type="hidden" name="orderId" value={o.id} />
                        <select name="status" defaultValue={o.status} className={selectCls}>
                          {CHAT_ORDER_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" size="sm" variant="outline">
                          Update
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
          <CardTitle>Synced orders</CardTitle>
        </CardHeader>
        <CardContent>
          {syncedOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No synced orders yet.</p>
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
                      <Badge variant={statusVariant(o.status)}>{o.status ?? 'unknown'}</Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(o.total, o.currency)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(o.createdAt)}</TableCell>
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
