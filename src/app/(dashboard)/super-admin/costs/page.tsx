import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { listFinancials } from '@/modules/super-admin/data';
import { gbp, usd, USD_TO_GBP } from '@/modules/super-admin/money';

export default async function CostsPage() {
  await requireRole([ROLES.SUPER_ADMIN]);
  const rows = await listFinancials();
  const totalUsd = rows.reduce((s, r) => s + r.aiCostUsd, 0);
  const totalGbp = rows.reduce((s, r) => s + r.aiCostGbp, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Cost"
        description="Estimated AI provider spend per company."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/super-admin/profit">Profit / loss</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/super-admin/usage">Usage</Link>
            </Button>
          </>
        }
      />

      {/*
        Was `InfoBanner`, which is amber-only. Nothing here needs attention —
        it explains what the two currency columns mean — so it takes `info`,
        leaving amber to mean "act on this" across the panel.
      */}
      <Alert tone="info">
        AI cost is calculated from token usage logged on every AI call (current calendar month) and
        is invoiced by the provider in <strong>USD</strong>. The GBP column converts at{' '}
        {USD_TO_GBP.toFixed(2)} GBP/USD so it can be compared with plan revenue.
      </Alert>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead className="text-end">AI cost (USD/mo)</TableHead>
                <TableHead className="text-end">AI cost (GBP/mo)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/super-admin/companies/${r.id}`} className="font-medium text-primary hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-end">{usd(r.aiCostUsd)}</TableCell>
                  <TableCell className="text-end">{gbp(r.aiCostGbp)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell className="text-end font-semibold">{usd(totalUsd)}</TableCell>
                <TableCell className="text-end font-semibold">{gbp(totalGbp)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
