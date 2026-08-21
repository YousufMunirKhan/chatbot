import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/format';
import { listMenuItems, listSyncedProducts } from '@/modules/company/integrations-data';

function EmptyState({ kind, detail }: { kind: string; detail: string }) {
  return (
    <div className="space-y-3 px-6 pb-6">
      <p className="max-w-2xl text-sm text-muted-foreground">
        No {kind} yet. This page is read-only — {detail} Connect your store or upload a CSV and they appear here.
      </p>
      <Button asChild size="sm">
        <Link href="/company/integrations">Import your {kind}</Link>
      </Button>
    </div>
  );
}

export default async function CompanyCatalogPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const [products, menuItems] = await Promise.all([listSyncedProducts(), listMenuItems()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Catalog</h1>
        <p className="text-sm text-muted-foreground">
          Products and menu items synced from your integrations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Products</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {products.length === 0 ? (
            <EmptyState kind="products" detail="products come from your integrations, not from typing them in." />
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
                      {p.status ? <Badge variant="secondary">{p.status}</Badge> : '—'}
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
        </CardHeader>
        <CardContent className="p-0">
          {menuItems.length === 0 ? (
            <EmptyState kind="menu items" detail="menu items come from your integrations, not from typing them in." />
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
                    <TableCell>{m.basePrice == null ? '—' : formatCurrency(m.basePrice)}</TableCell>
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
