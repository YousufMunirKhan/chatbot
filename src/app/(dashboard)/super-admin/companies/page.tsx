import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listCompanies } from '@/modules/super-admin/data';
import { planLabel } from '@/modules/super-admin/plans';
import { CompanyStatusBadge, SubStatusBadge } from '@/modules/super-admin/components/badges';
import { formatDate, formatNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CompaniesPage() {
  const companies = await listCompanies();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Companies</h1>
          <p className="text-sm text-muted-foreground">{companies.length} total</p>
        </div>
        <Button asChild>
          <Link href="/super-admin/companies/new">Onboard company</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Subscription</TableHead>
                <TableHead>AI replies</TableHead>
                <TableHead>Extra</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Credit</TableHead>
                <TableHead>AI cost</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Bots</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="py-8 text-center text-muted-foreground">
                    No companies yet.{' '}
                    <Link href="/super-admin/companies/new" className="text-primary hover:underline">
                      Onboard one
                    </Link>
                    .
                  </TableCell>
                </TableRow>
              ) : (
                companies.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/super-admin/companies/${c.id}`} className="font-medium text-primary hover:underline">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell><CompanyStatusBadge status={c.status} /></TableCell>
                    <TableCell>{planLabel(c.plan)}</TableCell>
                    <TableCell><SubStatusBadge status={c.subStatus} /></TableCell>
                    <TableCell>
                      {formatNumber(c.repliesUsed)} /{' '}
                      {c.repliesAvailable == null ? 'Unlimited' : formatNumber(c.repliesAvailable)}
                    </TableCell>
                    <TableCell>{formatNumber(c.extraReplies)}</TableCell>
                    <TableCell>
                      {c.repliesRemaining == null ? 'Unlimited' : formatNumber(c.repliesRemaining)}
                    </TableCell>
                    <TableCell>
                      {c.creditBalance == null ? '-' : gbp(c.creditBalance)}
                    </TableCell>
                    <TableCell>{usd(c.aiCostThisMonth)}</TableCell>
                    <TableCell>
                      <div className="min-w-[150px]">
                        <div>{c.whatsappOwner}</div>
                        <div className="text-xs text-muted-foreground">{c.whatsappProvider}</div>
                      </div>
                    </TableCell>
                    <TableCell>{formatNumber(c.memberCount)}</TableCell>
                    <TableCell>{formatNumber(c.botCount)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(c.createdAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function gbp(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 2,
  }).format(value);
}

function usd(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(value);
}
