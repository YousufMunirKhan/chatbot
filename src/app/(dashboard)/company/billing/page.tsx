import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { Alert, type AlertTone } from '@/components/ui/alert';
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
import { getBillingAccount } from '@/modules/company/billing-portal-data';
import { BillingAutoTopUpForm } from '@/modules/company/components/billing-auto-topup-form';
import { BillingInvoices } from '@/modules/company/components/billing-invoices';
import { BillingPortalButton } from '@/modules/company/components/billing-portal-button';

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

/**
 * What to say about the redirect the customer just came back from.
 *
 * Every hosted Stripe flow on this page ends in a redirect to here, and landing
 * on an unchanged-looking page after typing a card number is how a customer
 * ends up entering it twice. Each outcome gets a sentence saying what happened
 * and, where it matters, what is still left to do.
 */
const RETURN_NOTICES: Record<string, { tone: AlertTone; title: string; body: string }> = {
  'status:success': {
    tone: 'success',
    title: 'Payment received',
    body: 'Your package is up to date. An invoice appears below once Stripe finalises it.',
  },
  'status:cancel': {
    tone: 'info',
    title: 'Checkout cancelled',
    body: 'Nothing was charged and your package has not changed.',
  },
  'card:saved': {
    tone: 'success',
    title: 'Card saved',
    body: 'It is selected for automatic top-up below. Tick "Top up automatically" and save if you have not already — saving a card does not start charging it.',
  },
  'card:cancelled': {
    tone: 'info',
    title: 'No card was saved',
    body: 'You left Stripe before finishing. Nothing has changed.',
  },
  'card:incomplete': {
    tone: 'warning',
    title: 'Stripe did not finish saving that card',
    body: 'It may have been declined during verification. Try again, or use a different card.',
  },
  'card:mismatch': {
    tone: 'danger',
    title: 'That card was not saved',
    body: 'The card setup did not belong to this account, so nothing was changed. Start again from "Add a card".',
  },
  'card:failed': {
    tone: 'danger',
    title: 'Could not save that card',
    body: 'Stripe has it, but we could not attach it to your top-up settings. Try again, and contact support if it keeps happening.',
  },
  'card:unavailable': {
    tone: 'warning',
    title: 'Card payments are switched off',
    body: 'This platform has no Stripe keys configured. Contact support.',
  },
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams?: { status?: string; card?: string };
}) {
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
    account,
  ] = await Promise.all([
    getCurrentCompany(),
    getSubscription(companyId),
    getReplyAllowanceUsage(companyId),
    listBillingPlans({ publicOnly: true }),
    getAutoTopUpSettings(),
    listAutoTopUpAttempts(),
    getCreditBalance(),
    listEntitlements(companyId),
    getBillingAccount(),
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

  const notice =
    (searchParams?.card ? RETURN_NOTICES[`card:${searchParams.card}`] : undefined) ??
    (searchParams?.status ? RETURN_NOTICES[`status:${searchParams.status}`] : undefined);

  // The subscription flows deep-link into Stripe's portal, and Stripe rejects
  // them without a subscription id. A company still on the trial has none, so
  // it gets the plan picker at the bottom of this page instead.
  const hasStripeSubscription = Boolean(account.subscriptionId);
  const renewal = account.subscription;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Billing"
        description="What you are on, how many replies that includes each month, your invoices, and where your subscription stands."
      />

      {notice ? (
        <Alert tone={notice.tone} title={notice.title}>
          {notice.body}
        </Alert>
      ) : null}

      {/* Only when Stripe IS configured but did not answer. A platform with no
          Stripe keys is not a fault to report at the top of the page — each
          section below says so in the place it matters. */}
      {account.error && account.stripeConfigured ? (
        <Alert tone="warning" title="Some billing details could not be loaded">
          {account.error} Your package and allowance below are read from this account and are
          correct; invoices and saved cards may be incomplete until Stripe answers again.
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>
            {planDef?.label ?? plan ?? 'No plan'} - {gbp(price)}/mo
          </CardTitle>
          <Badge variant={statusVariant(status)}>{status ?? 'none'}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
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
            {/* Read live from Stripe: nothing writes `current_period_end` to
                this database, and "cancels on the 5th" is not stored here at
                all, so both are shown only when Stripe answered. */}
            {renewal?.currentPeriodEndIso ? (
              <Row
                label={renewal.cancelAtPeriodEnd ? 'Access ends' : 'Renews on'}
                value={formatDate(renewal.currentPeriodEndIso)}
              />
            ) : null}
          </div>

          {renewal?.cancelAtPeriodEnd ? (
            <Alert tone="warning" title="This package is set to cancel">
              You keep everything below until {formatDate(renewal.currentPeriodEndIso)}. You can
              undo the cancellation in the billing portal.
            </Alert>
          ) : null}

          {/* The webhook marks a company past_due on a failed invoice and emails
              "please update your payment method". This is that link, pointing
              at the one portal screen that fixes it rather than at the portal
              home for the customer to go hunting. */}
          {status === 'past_due' ? (
            <Alert tone="danger" title="Your last payment did not go through">
              <p>
                Your assistant keeps running for now, but the package will be suspended if the
                payment is not settled. Update the card Stripe charges and it will retry.
              </p>
              <div className="mt-3">
                <BillingPortalButton flow="payment_method_update" size="sm">
                  Update payment method
                </BillingPortalButton>
              </div>
            </Alert>
          ) : null}

          {/* Stripe's hosted portal is the answer to invoices, cards, plan
              changes, billing address, VAT number and cancellation. None of
              that is rebuilt here — doing so would put this server in the path
              of card data to reproduce something Stripe already runs. */}
          <div className="flex flex-wrap items-start gap-3 border-t pt-4">
            <BillingPortalButton disabled={!account.stripeConfigured}>
              Manage billing on Stripe
            </BillingPortalButton>
            {hasStripeSubscription ? (
              <>
                <BillingPortalButton
                  variant="outline"
                  flow="subscription_update"
                  disabled={!account.stripeConfigured}
                >
                  Change package
                </BillingPortalButton>
                <BillingPortalButton
                  variant="outline"
                  flow="subscription_cancel"
                  disabled={!account.stripeConfigured}
                >
                  Cancel package
                </BillingPortalButton>
              </>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {account.stripeConfigured
              ? 'Invoices, saved cards, your billing address and cancellation are all handled on Stripe’s own secure pages. This app never sees your card details.'
              : 'Card payments are not switched on for this platform yet, so the billing portal is unavailable. Contact support.'}
          </p>
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
          plan picker because it is the answer to the number directly above it.
          The card is chosen from the ones Stripe holds; the field that used to
          ask for a `pm_…` id is gone, because no customer could produce one. */}
      <Card id="auto-topup">
        <CardHeader>
          <CardTitle>Automatic top-up</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <BillingAutoTopUpForm
            config={autoTopUp}
            balance={creditBalance}
            cards={account.cards}
            stripeConfigured={account.stripeConfigured}
          />

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
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>Invoices</CardTitle>
          {account.customerId ? (
            <BillingPortalButton variant="outline" size="sm">
              All invoices &amp; receipts
            </BillingPortalButton>
          ) : null}
        </CardHeader>
        <CardContent>
          {!account.stripeConfigured ? (
            <p className="text-sm text-muted-foreground">
              Card payments are not switched on for this platform, so there are no invoices to show.
            </p>
          ) : (
            <BillingInvoices invoices={account.invoices} />
          )}
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
