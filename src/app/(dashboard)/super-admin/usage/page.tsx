import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listCompanies } from '@/modules/super-admin/data';
import { formatNumber } from '@/lib/format';

export default async function UsagePage() {
  const companies = await listCompanies();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="text-sm text-muted-foreground">
          Billable AI replies, extra grants, remaining allowance, and internal cost this month.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>AI replies used</TableHead>
                <TableHead>Base allowance</TableHead>
                <TableHead>Extra replies</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Internal AI cost</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead>Bots</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/super-admin/companies/${c.id}`} className="font-medium text-primary hover:underline">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell>{formatNumber(c.repliesUsed)}</TableCell>
                  <TableCell>{c.messageLimit == null ? 'Unlimited' : formatNumber(c.messageLimit)}</TableCell>
                  <TableCell>{formatNumber(c.extraReplies)}</TableCell>
                  <TableCell>
                    {c.repliesRemaining == null ? 'Unlimited' : formatNumber(c.repliesRemaining)}
                  </TableCell>
                  <TableCell>{usd(c.aiCostThisMonth)}</TableCell>
                  <TableCell>
                    {c.whatsappOwner}
                    <span className="block text-xs text-muted-foreground">{c.whatsappProvider}</span>
                  </TableCell>
                  <TableCell>{formatNumber(c.botCount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
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
