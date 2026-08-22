import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { listCompanies } from '@/modules/super-admin/data';
import { formatNumber } from '@/lib/format';
import { usd } from '@/modules/super-admin/money';

export default async function UsagePage() {
  await requireRole([ROLES.SUPER_ADMIN]);
  const companies = await listCompanies();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage"
        description="Billable AI replies, extra grants, remaining allowance, and internal cost this month."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/super-admin/costs">AI cost</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/super-admin/profit">Profit / loss</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/super-admin/subscriptions">Subscriptions</Link>
            </Button>
          </>
        }
      />

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
                <TableHead>Internal AI cost (USD)</TableHead>
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
