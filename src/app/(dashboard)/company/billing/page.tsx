import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/progress';
import { getCompanyId, getCurrentCompany } from '@/modules/company/data';
import { getReplyAllowanceUsage, getSubscription } from '@/lib/billing';
import { listEntitlements, type FeatureEntitlement } from '@/lib/entitlements';
import { formatDate, formatNumber } from '@/lib/format';
import { BillingUpgrade } from '@/modules/company/components/billing-upgrade';
import { listBillingPlans } from '@/modules/super-admin/billing-data';
import {
  getAutoTopUpSettings,
  getCreditBalance,
  listAutoTopUpAttempts,
} from '@/modules/company/auto-topup-data';
import { AutoTopUpForm } from '@/modules/company/components/auto-topup-form';

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

/** Exact pounds and pence — a top-up of £2.50 must not render as £3. */
function gbpExact(cents: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(cents / 100);
}

function statusVariant(status: string | null): 'success' | 'warning' | 'secondary' {
  if (status === 'active') return 'success';
  if (status === 'trialing') return 'warning';
  return 'secondary';
}

export default async function BillingPage() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const [
    { subscription },
    sub,
    replyUsage,
    publicPlans,
    autoTopUp,
    autoTopUpAttempts,
    creditBalance,
    entitlements,
  ] = await Promise.all([
    getCurrentCompany(),
    getSubscription(companyId),
    getReplyAllowanceUsage(companyId),
    listBillingPlans({ publicOnly: true }),
    getAutoTopUpSettings(),
    listAutoTopUpAttempts(),
    getCreditBalance(),
    listEntitlements(companyId),
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
  const included = entitlements.filter((item) => item.enabled);
  const notIncluded = entitlements.filter((item) => !item.enabled);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Billing"
        description="What you are on, how many replies that includes each month, and where your subscription stands."
      />

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

      {/* Migration 0065 — the plan's feature entitlements. It sits directly under
          the plan summary because it finishes the same sentence: the card above
          says how much you get, this one says which parts of the product you get
          at all. Both lists are shown, since "what I am missing" is the question
          that sends an owner to the package picker at the bottom of the page. */}
      <Card>
        <CardHeader>
          <CardTitle>What your package includes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-medium">Included</p>
            {included.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Your package covers website chat only. Everything below is available on a larger
                package.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {included.map((item) => (
                  <FeatureRow key={item.feature} item={item} />
                ))}
              </ul>
            )}
          </div>

          {notIncluded.length > 0 ? (
            <div className="space-y-3 border-t pt-4">
              <p className="text-sm font-medium">Not on this package</p>
              <ul className="grid gap-3 sm:grid-cols-2">
                {notIncluded.map((item) => (
                  <FeatureRow key={item.feature} item={item} />
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                To use these, move to a larger package under &ldquo;Change package&rdquo; below, or
                ask support to add one to your account.
              </p>
            </div>
          ) : null}
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
          <Progress value={usagePct ?? 0} label="AI replies used this month" />
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

      {/* Migration 0057 — automatic credit top-up. Sits between usage and the
          plan picker because it is the answer to the number directly above it. */}
      <Card id="auto-topup">
        <CardHeader>
          <CardTitle>Automatic top-up</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <AutoTopUpForm config={autoTopUp} balance={creditBalance} />

          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">Recent top-ups</p>
            {autoTopUpAttempts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No top-up attempts yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {autoTopUpAttempts.map((attempt) => (
                  <li key={attempt.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <span className="font-medium">
                        {gbpExact(attempt.amountCents)}
                      </span>{' '}
                      <span className="text-muted-foreground">{formatDate(attempt.createdAt)}</span>
                      {attempt.error ? (
                        <p className="text-xs text-danger-fg">{attempt.error}</p>
                      ) : null}
                    </div>
                    <Badge variant={attempt.status === 'succeeded' ? 'success' : 'destructive'}>
                      {attempt.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
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

/**
 * One feature, with the badge saying where the answer came from. "Added for you"
 * is worth its own wording: a company given a feature by support would otherwise
 * see it listed as included and reasonably assume a package change would keep
 * it, which is exactly the call that ends up with support.
 */
function FeatureRow({ item }: { item: FeatureEntitlement }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{item.label}</p>
        <p className="text-xs text-muted-foreground">{item.description}</p>
      </div>
      {item.enabled ? (
        <Badge variant={item.overridden ? 'info' : 'success'}>
          {item.overridden ? 'Added for you' : 'Included'}
        </Badge>
      ) : (
        <Badge variant="secondary">Not included</Badge>
      )}
    </li>
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
