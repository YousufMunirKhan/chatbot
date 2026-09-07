import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listCompanies } from '@/modules/super-admin/data';
import { planLabel } from '@/modules/super-admin/plans';
import { CompanyStatusBadge, SubStatusBadge } from '@/modules/super-admin/components/badges';
import { DeleteCompanyDialog } from '@/modules/super-admin/components/delete-company-dialog';
import { formatDate, formatNumber } from '@/lib/format';
// Was a second, byte-for-byte pair of local `gbp`/`usd` formatters at the foot
// of this file. The shared module is the one the currency work landed in.
import { gbp, usd } from '@/modules/super-admin/money';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CompaniesPage() {
  // Defence in depth: the /super-admin layout already guards this subtree, but a
  // platform-operator surface should not rely on a single ancestor check.
  await requireRole([ROLES.SUPER_ADMIN]);
  const companies = await listCompanies();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Companies"
        description={`${companies.length} total`}
        actions={
          <Button asChild>
            <Link href="/super-admin/companies/new">Onboard company</Link>
          </Button>
        }
      />

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
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="py-0">
                    <EmptyState
                      title={
                        <>
                          No companies yet.{' '}
                          <Link href="/super-admin/companies/new" className="text-primary hover:underline">
                            Onboard one
                          </Link>
                          .
                        </>
                      }
                    />
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
                    <TableCell className="text-right">
                      <DeleteCompanyDialog companyId={c.id} companyName={c.name} />
                    </TableCell>
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
