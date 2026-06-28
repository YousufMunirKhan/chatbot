import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InfoBanner } from '@/components/info-banner';
import { listFinancials } from '@/modules/super-admin/data';

export default async function CostsPage() {
  const rows = await listFinancials();
  const total = rows.reduce((s, r) => s + r.aiCost, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AI Cost</h1>
        <p className="text-sm text-muted-foreground">Estimated AI provider spend per company.</p>
      </div>

      <InfoBanner>
        AI cost is calculated from token usage logged on every AI call (current calendar month).
      </InfoBanner>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead className="text-right">AI cost (mo)</TableHead>
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
                  <TableCell className="text-right">{usd(r.aiCost)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell className="text-right font-semibold">{usd(total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function usd(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(value);
}
