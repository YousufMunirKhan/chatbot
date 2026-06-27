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
import { listCompanies } from '@/modules/super-admin/data';
import { SubStatusBadge } from '@/modules/super-admin/components/badges';
import { formatDate, formatNumber } from '@/lib/format';
import { listBillingPlans } from '@/modules/super-admin/billing-data';

function gbp(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

export default async function SubscriptionsPage() {
  const [companies, plans] = await Promise.all([listCompanies(), listBillingPlans()]);
  const planByKey = new Map(plans.map((plan) => [plan.key, plan]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Subscriptions</h1>
        <p className="text-sm text-muted-foreground">
          Plans, statuses, limits, and Stripe-backed package pricing per company.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Price/mo</TableHead>
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
    </div>
  );
}
