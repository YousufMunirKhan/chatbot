import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ROLES, SUBSCRIPTION_STATUS_LABELS, humanizeToken, labelFor } from '@/lib/constants';
// The public pricing page and this page have to agree about tax, so there is
// exactly one sentence about it and both import it. See the comment on
// `VAT_STATEMENT` for what it is asserting and why that assertion is true.
import { VAT_SHORT, VAT_STATEMENT } from '@/app/(marketing)/pricing/plan-catalogue';
import { Alert, type AlertTone } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/progress';
import { SectionHeader } from '@/components/ui/section-header';
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

/**
 * The badge tone for a subscription status.
 *
 * `past_due` and `incomplete` used to fall through to `secondary` — a neutral
 * grey pill reading "past_due", directly above a red alert explaining that the
 * payment failed and the account is about to be suspended. The badge and the
 * alert have to agree about how bad it is.
 */
function statusVariant(status: string | null): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (status === 'active') return 'success';
  if (status === 'trialing') return 'warning';
  if (status === 'past_due' || status === 'incomplete') return 'destructive';
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
        {/*
          `CardHeader` is `flex flex-col space-y-1.5`. Overriding only
          `flex-row` left `space-y-1.5` in place, which in a row puts a 6px
          margin-TOP on the badge — so the badge sat 6px below the centre line
          `items-center` had just aligned it to. Every one of these headers in
          the product had the same 6px error. `space-y-0` removes it, and
          `flex-wrap` stops the badge being crushed against a title that is a
          plan name, a price and a VAT note at 375px.
        */}
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle>
            {/* Was a hyphen doing the job of an em dash between two unrelated
                facts, which reads as a compound name ("Growth - £49/mo"). */}
            {planDef?.label ?? plan ?? 'No plan'} — {gbp(price)}/mo
            {price > 0 ? ` ${VAT_SHORT}` : ''}
          </CardTitle>
          {/* Printed the stored value — an owner read "past_due" and "trialing".
              `SUBSCRIPTION_STATUS_LABELS` has said "Payment failed" and "On a
              free trial" in `lib/constants` all along; this page was the one
              place not asking it. */}
          <Badge variant={statusVariant(status)}>
            {labelFor(SUBSCRIPTION_STATUS_LABELS, status ?? 'none')}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* A `<dl>`, because that is what eight term-and-value pairs are. The
              grid is still `auto-fit` so it asks the CARD how many columns it
              can afford rather than asking the window. */}
          <dl className="grid gap-3 text-sm [grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))]">
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
          </dl>

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
          <p className="text-xs text-muted-foreground">{VAT_STATEMENT}</p>
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
            {/* Was `<p className="text-sm font-medium">` — a paragraph styled to
                look like a heading, which puts NOTHING in the document outline.
                A screen-reader user navigating this page by heading heard "What
                your package includes" and then, with no further landmark, a
                single undifferentiated run of twenty features — the "Included"
                and "Not on this package" division that a sighted reader gets for
                free simply did not exist for them. `SectionHeader` renders a
                real heading at the level the outline needs (the card title is
                the `<h2>`, so these are `<h3>`) while looking exactly the same. */}
            <SectionHeader level={3} size="eyebrow" title="Included" />
            {included.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Your package covers website chat only. Everything below is available on a larger
                package.
              </p>
            ) : (
              // Each row is a label, a sentence of description and a badge on
              // the same line. `sm:grid-cols-2` gave that ~280px from 640px
              // upward, where the badge ("Not included") took a third of the
              // row and the description wrapped to four lines. A floor, not a
              // count.
              <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(19rem,1fr))]">
                {included.map((item) => (
                  <FeatureRow key={item.feature} item={item} />
                ))}
              </ul>
            )}
          </div>

          {notIncluded.length > 0 ? (
            <div className="space-y-3 border-t pt-4">
              <SectionHeader level={3} size="eyebrow" title="Not on this package" />
              <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(19rem,1fr))]">
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
          {/* `flex items-end justify-between` with no wrap: at 375px the card is
              ~295px of content, and "AI replies used" plus "128,400 / 150,000"
              at `text-2xl` is comfortably wider than that. The two ran into each
              other and the figure — the only thing on this card anybody reads —
              was the half that got clipped. `flex-wrap` drops the number onto
              its own line instead, and `gap-x-4` keeps them apart when they do
              share one. */}
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <span className="text-sm text-muted-foreground">AI replies used</span>
            <span className="text-2xl font-semibold tabular-nums">
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
            <SectionHeader
              level={3}
              size="eyebrow"
              title="Recent top-ups"
              description="Every automatic charge we have attempted, newest first."
            />
            {autoTopUpAttempts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing yet. Once automatic top-up is on and your balance runs low, each attempt is
                listed here with whether it went through.
              </p>
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
                    {/* `humanizeToken`, so a new Stripe status reads as
                        "Requires action" rather than "requires_action". */}
                    <Badge variant={attempt.status === 'succeeded' ? 'success' : 'destructive'}>
                      {humanizeToken(attempt.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
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
        <CardContent className="space-y-4">
          <BillingUpgrade plans={publicPlans} currentPlan={plan} />
          {/* The public page reads the same catalogue this picker does, so the
              two always show the same figures. It is worth linking because it
              carries the side-by-side comparison and the feature matrix, which
              is what someone weighing up a change actually wants to read. */}
          <p className="text-xs text-muted-foreground">
            Every package is compared side by side on the{' '}
            <Link href="/pricing" className="font-medium text-primary underline-offset-4 hover:underline">
              public price list
            </Link>
            .
          </p>
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

/**
 * One "Renews on / 5 March 2026" pair in the plan summary.
 *
 * Two `<span>`s in a `flex justify-between` are two unrelated strings that
 * happen to sit near each other: a screen reader reads eight labels and eight
 * values as sixteen loose items, and there is nothing saying which value
 * belongs to which label. `<dt>`/`<dd>` is the markup that says it, and it
 * costs nothing — the wrapping `<dl>` is on the grid.
 *
 * `gap-x-4` and `min-w-0` on both halves because a flex item will not shrink
 * below its longest unbreakable word: "Integration limit" against "Unlimited"
 * is fine, but the pair sits in an `auto-fit` track that can be 256px, and
 * without the floor removed the label was squeezed to one word per line.
 * `last:border-0` was also wrong — these are grid items, so "last" is the last
 * of eight, not the last of each column, and one arbitrary cell lost its rule.
 */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 border-b pb-2">
      <dt className="min-w-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium">{value}</dd>
    </div>
  );
}
