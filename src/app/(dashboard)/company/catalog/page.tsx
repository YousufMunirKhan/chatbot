import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES, CATALOG_STATUS_LABELS, labelFor } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/format';
import { listMenuItems, listSyncedProducts } from '@/modules/company/integrations-data';

/** Both catalog tabs are read-only mirrors of an integration, so they share one
 *  empty state that names the integration as the only way to fill it. */
function NothingSynced({ kind, detail }: { kind: string; detail: string }) {
  return (
    <EmptyState
      title={`No ${kind} yet.`}
      body={`You cannot type ${kind} in here — ${detail} Connect your shop or upload a spreadsheet and they appear on this page, and your assistant can start quoting them.`}
      action={
        <Button asChild size="sm">
          <Link href="/company/integrations">Connect your shop</Link>
        </Button>
      }
    />
  );
}

export default async function CompanyCatalogPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [products, menuItems] = await Promise.all([listSyncedProducts(), listMenuItems()]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Products"
        description="What your assistant can quote a price for. This list is a copy of your shop — change a price in Shopify or WooCommerce and it changes here, not the other way round."
      />

      <Card>
        <CardHeader>
          <CardTitle>Things you sell</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {products.length === 0 ? (
            <NothingSynced kind="products" detail="they are copied from the shop you connect." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.title}</TableCell>
                    <TableCell>
                      {p.price == null ? '—' : formatCurrency(p.price, p.currency ?? 'USD')}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.sku ?? '—'}</TableCell>
                    <TableCell>
                      {p.status ? (
                        <Badge variant="secondary">{labelFor(CATALOG_STATUS_LABELS, p.status)}</Badge>
                      ) : (
                        '—'
                      )}
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
          <CardTitle>Menu items</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            For cafés and restaurants — dishes and drinks, kept separately from products.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {menuItems.length === 0 ? (
            <NothingSynced kind="menu items" detail="they are copied from the till or shop you connect." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Base price</TableHead>
                  <TableHead>Available</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {menuItems.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-muted-foreground">{m.category ?? '—'}</TableCell>
                    <TableCell>{m.basePrice == null ? '—' : formatCurrency(m.basePrice, 'USD')}</TableCell>
                    <TableCell>
                      <Badge variant={m.isAvailable ? 'success' : 'secondary'}>
                        {m.isAvailable ? 'Available' : 'Unavailable'}
                      </Badge>
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
