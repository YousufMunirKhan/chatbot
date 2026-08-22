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

export default async function ProfitPage() {
  await requireRole([ROLES.SUPER_ADMIN]);
  const rows = await listFinancials();
  const totals = rows.reduce(
    (t, r) => ({
      planRevenueGbp: t.planRevenueGbp + r.planRevenueGbp,
      addonRevenueGbp: t.addonRevenueGbp + r.addonRevenueGbp,
      revenueGbp: t.revenueGbp + r.revenueGbp,
      aiCostUsd: t.aiCostUsd + r.aiCostUsd,
      aiCostGbp: t.aiCostGbp + r.aiCostGbp,
      profitGbp: t.profitGbp + r.profitGbp,
    }),
    {
      planRevenueGbp: 0,
      addonRevenueGbp: 0,
      revenueGbp: 0,
      aiCostUsd: 0,
      aiCostGbp: 0,
      profitGbp: 0,
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profit / Loss"
        description="Plan revenue, internal AI cost, and estimated margin per company."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/super-admin/costs">AI cost detail</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/super-admin/subscriptions">Subscriptions</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/super-admin/usage">Usage</Link>
            </Button>
          </>
        }
      />

      {/* Explanatory, not actionable — `info`, not the old amber `InfoBanner`. */}
      <Alert tone="info">
        Revenue is <strong>GBP</strong>, read from the editable plan prices in Billing &amp; Plans
        plus any active add-ons. AI provider cost is invoiced in <strong>USD</strong> and is
        converted at {USD_TO_GBP.toFixed(2)} GBP/USD — the same rate customer credit is charged at —
        before the margin is calculated. One-off setup fees are excluded: this is a recurring
        monthly view.
      </Alert>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead className="text-end">Plan revenue (GBP)</TableHead>
                  <TableHead className="text-end">Add-ons (GBP)</TableHead>
                  <TableHead className="text-end">AI cost (USD)</TableHead>
                  <TableHead className="text-end">AI cost (GBP)</TableHead>
                  <TableHead className="text-end">Est. margin (GBP)</TableHead>
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
                    <TableCell className="text-end">{gbp(r.planRevenueGbp)}</TableCell>
                    <TableCell className="text-end">{gbp(r.addonRevenueGbp)}</TableCell>
                    <TableCell className="text-end">{usd(r.aiCostUsd)}</TableCell>
                    <TableCell className="text-end">{gbp(r.aiCostGbp)}</TableCell>
                    <TableCell
                      className={`text-end ${r.profitGbp < 0 ? 'font-medium text-danger-fg' : ''}`}
                    >
                      {gbp(r.profitGbp)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-end font-semibold">{gbp(totals.planRevenueGbp)}</TableCell>
                  <TableCell className="text-end font-semibold">{gbp(totals.addonRevenueGbp)}</TableCell>
                  <TableCell className="text-end font-semibold">{usd(totals.aiCostUsd)}</TableCell>
                  <TableCell className="text-end font-semibold">{gbp(totals.aiCostGbp)}</TableCell>
                  <TableCell className="text-end font-semibold">{gbp(totals.profitGbp)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
