import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { listCompanies } from '@/modules/super-admin/data';
import { SubStatusBadge } from '@/modules/super-admin/components/badges';
import { formatDate, formatNumber } from '@/lib/format';
import { gbp } from '@/modules/super-admin/money';
import { listBillingPlans } from '@/modules/super-admin/billing-data';

export default async function SubscriptionsPage() {
  await requireRole([ROLES.SUPER_ADMIN]);
  const [companies, plans] = await Promise.all([listCompanies(), listBillingPlans()]);
  const planByKey = new Map(plans.map((plan) => [plan.key, plan]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscriptions"
        description="Plans, statuses, limits, and Stripe-backed package pricing per company."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/super-admin/billing">Billing &amp; plans</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/super-admin/profit">Profit / loss</Link>
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Price/mo (GBP)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Message limit</TableHead>
                <TableHead>Free until</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => {
                const plan = company.plan ? planByKey.get(company.plan) : null;
                return (
                  <TableRow key={company.id}>
                    <TableCell>
                      <Link
                        href={`/super-admin/companies/${company.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {company.name}
                      </Link>
                    </TableCell>
                    <TableCell>{plan?.label ?? company.plan ?? '-'}</TableCell>
                    <TableCell>{company.plan ? gbp(plan?.priceMonthlyGbp ?? 0) : '-'}</TableCell>
                    <TableCell>
                      <SubStatusBadge status={company.subStatus} />
                    </TableCell>
                    <TableCell>
                      {company.messageLimit == null
                        ? 'Unlimited'
                        : formatNumber(company.messageLimit)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(company.freeUntil)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        <strong className="font-medium text-foreground">Free until</strong> is a note shown to the
        company on their billing page. Nothing in plan enforcement reads it — to actually stop
        charging or lift limits, change the subscription status or the limits themselves.
      </p>
    </div>
  );
}
