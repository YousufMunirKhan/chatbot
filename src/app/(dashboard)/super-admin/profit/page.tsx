import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InfoBanner } from '@/components/info-banner';
import { listFinancials } from '@/modules/super-admin/data';
import { formatCurrency } from '@/lib/format';

export default async function ProfitPage() {
  const rows = await listFinancials();
  const totals = rows.reduce(
    (t, r) => ({ revenue: t.revenue + r.revenue, aiCost: t.aiCost + r.aiCost, profit: t.profit + r.profit }),
    { revenue: 0, aiCost: 0, profit: 0 },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Profit / Loss</h1>
        <p className="text-sm text-muted-foreground">Revenue − AI cost, per company.</p>
      </div>

      <InfoBanner>
        Revenue is derived from assigned plans. AI cost becomes live with{' '}
        <strong>Module 20</strong>; until then profit equals revenue.
      </InfoBanner>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead className="text-right">Revenue (mo)</TableHead>
                <TableHead className="text-right">AI cost (mo)</TableHead>
                <TableHead className="text-right">Profit (mo)</TableHead>
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
                  <TableCell className="text-right">{formatCurrency(r.revenue)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.aiCost)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.profit)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(totals.revenue)}</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(totals.aiCost)}</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(totals.profit)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
