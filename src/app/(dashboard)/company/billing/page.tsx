import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCompanyId, getCurrentCompany } from '@/modules/company/data';
import { getReplyAllowanceUsage, getSubscription } from '@/lib/billing';
import { formatDate, formatNumber } from '@/lib/format';
import { BillingUpgrade } from '@/modules/company/components/billing-upgrade';
import { listBillingPlans } from '@/modules/super-admin/billing-data';

function lim(n: number | null) {
  return n == null ? 'Unlimited' : formatNumber(n);
}

function gbp(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

function statusVariant(status: string | null): 'success' | 'warning' | 'secondary' {
  if (status === 'active') return 'success';
  if (status === 'trialing') return 'warning';
  return 'secondary';
}

export default async function BillingPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const [{ subscription }, sub, replyUsage, publicPlans] = await Promise.all([
    getCurrentCompany(),
    getSubscription(companyId),
    getReplyAllowanceUsage(companyId),
    listBillingPlans({ publicOnly: true }),
  ]);

  const plan = subscription.plan;
  const planDef = publicPlans.find((item) => item.key === plan);
  const price = planDef?.priceMonthlyGbp ?? 0;
  const status = sub?.status ?? subscription.status ?? null;
  const freeUntil = sub?.freeUntil ?? subscription.freeUntil;
  const messageLimit = sub?.messageLimit ?? subscription.messageLimit;
  const totalAvailable = replyUsage.totalAvailable;
  const usagePct =
    totalAvailable && totalAvailable > 0
      ? Math.min(100, Math.round((replyUsage.used / totalAvailable) * 100))
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Your package, monthly message allowance, and subscription status.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>
            {planDef?.label ?? plan ?? 'No plan'} - {gbp(price)}/mo
          </CardTitle>
          <Badge variant={statusVariant(status)}>{status ?? 'none'}</Badge>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Row label="Free until" value={formatDate(freeUntil)} />
          <Row label="Monthly AI replies" value={lim(messageLimit)} />
          <Row label="Extra replies added" value={formatNumber(replyUsage.extraReplies)} />
          <Row label="Allowance resets" value={formatDate(replyUsage.resetAt)} />
          <Row label="Assistant limit" value={lim(sub?.botLimit ?? subscription.botLimit)} />
          <Row label="Team seat limit" value={lim(sub?.agentLimit ?? subscription.agentLimit)} />
          <Row
            label="Integration limit"
            value={lim(sub?.integrationLimit ?? subscription.integrationLimit)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI reply usage this month</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end justify-between">
            <span className="text-sm text-muted-foreground">AI replies used</span>
            <span className="text-2xl font-semibold">
              {formatNumber(replyUsage.used)} /{' '}
              {totalAvailable == null ? 'Unlimited' : formatNumber(totalAvailable)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${usagePct ?? 0}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {totalAvailable == null
              ? 'Unlimited AI replies on your current package.'
              : `${usagePct}% used. Your base monthly allowance is ${formatNumber(messageLimit ?? 0)}${
                  replyUsage.extraReplies > 0
                    ? `, plus ${formatNumber(replyUsage.extraReplies)} extra replies added by support`
                    : ''
                }.`}
          </p>
          <p className="text-xs text-muted-foreground">
            Unused monthly replies expire at the end of each billing month and do not roll over.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change package</CardTitle>
        </CardHeader>
        <CardContent>
          <BillingUpgrade plans={publicPlans} currentPlan={plan} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b pb-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
