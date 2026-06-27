import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { formatNumber } from '@/lib/format';
import { StripePriceForm } from '@/modules/super-admin/components/stripe-price-form';
import { BillingPlanForm } from '@/modules/super-admin/components/billing-plan-form';
import {
  getCompanyPlanUsageSummary,
  listBillingPlans,
  listBillingPlansWithStripe,
} from '@/modules/super-admin/billing-data';

function gbp(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

function lim(value: number | null) {
  return value == null ? 'Unlimited' : formatNumber(value);
}

export default async function SuperAdminBillingPage() {
  await requireRole([ROLES.SUPER_ADMIN]);
  const [plans, plansWithStripe, riskRows] = await Promise.all([
    listBillingPlans(),
    listBillingPlansWithStripe(),
    getCompanyPlanUsageSummary(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Billing & Plans</h1>
          <p className="text-sm text-muted-foreground">
            Customers see packages and message allowances. Super-admin sees Stripe, AI cost, and
            margin risk.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/super-admin/settings">Stripe settings</Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {plans
          .filter((plan) => plan.isDefault && plan.key !== 'free_trial' && plan.key !== 'custom')
          .map((plan) => (
            <Card key={plan.key}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{plan.label}</CardTitle>
                  <Badge variant={plan.isActive ? 'success' : 'secondary'}>
                    {plan.isActive ? 'Active' : 'Off'}
                  </Badge>
                </div>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-2xl font-semibold">{gbp(plan.priceMonthlyGbp)}/mo</p>
                <Row label="Messages" value={lim(plan.messageLimit)} />
                <Row label="Assistants" value={lim(plan.botLimit)} />
                <Row label="Integrations" value={lim(plan.integrationLimit)} />
              </CardContent>
            </Card>
          ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Model cost guardrails</CardTitle>
          <CardDescription>
            To avoid losses, keep cheap plans on the default model and reserve advanced model
            routing for higher-value packages.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-md border p-3">
            <p className="font-medium">Free Trial / Starter</p>
            <p className="mt-1 text-muted-foreground">
              Use default model only. Best for website sales, FAQs, lead capture, and booking.
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="font-medium">Business / Pro</p>
            <p className="mt-1 text-muted-foreground">
              Advanced routing is allowed for harder questions and support workflows.
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="font-medium">Custom / help desk bots</p>
            <p className="mt-1 text-muted-foreground">
              Quote higher, set hard AI budget caps, and review usage weekly.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Packages</CardTitle>
          <CardDescription>
            Keep the public promise simple: plan price and message allowance. Internal AI credit
            stays super-admin only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {plans.map((plan) => (
            <BillingPlanForm key={plan.key} plan={plan} />
          ))}
          <div>
            <h3 className="mb-3 text-sm font-semibold">Create custom package</h3>
            <BillingPlanForm />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stripe price mapping</CardTitle>
          <CardDescription>
            Add the recurring Stripe price ID for each package. Company admins can buy only active
            public mapped plans.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <StripePriceForm plans={plans} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Package</TableHead>
                <TableHead>Stripe price</TableHead>
                <TableHead>Overage</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plansWithStripe.map((plan) => (
                <TableRow key={plan.key}>
                  <TableCell>{plan.label}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {plan.stripePriceId ?? 'Not mapped'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{plan.overagePriceId ?? '-'}</TableCell>
                  <TableCell>{plan.stripeEnabled ? 'enabled' : 'disabled'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Loss-risk companies</CardTitle>
          <CardDescription>
            Watch companies where AI cost is eating too much of plan revenue. Move heavy users to
            Business, Pro, or custom.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Messages</TableHead>
                <TableHead>AI cost</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {riskRows.map((row) => (
                <TableRow key={row.companyId}>
                  <TableCell className="font-medium">{row.companyName}</TableCell>
                  <TableCell>{row.plan ?? '-'}</TableCell>
                  <TableCell>
                    {formatNumber(row.usedMessages)} / {lim(row.messageLimit)}
                  </TableCell>
                  <TableCell>${row.aiCostUsd.toFixed(2)}</TableCell>
                  <TableCell>{gbp(row.planRevenueGbp)}</TableCell>
                  <TableCell>
                    {row.risk === 'loss' ? (
                      <Badge variant="destructive">Move to paid/custom</Badge>
                    ) : row.risk === 'watch' ? (
                      <Badge variant="warning">Watch margin</Badge>
                    ) : (
                      <Badge variant="success">OK</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {riskRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No usage risk yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b pb-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
