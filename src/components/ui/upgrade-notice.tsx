import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import {
  PLANS,
  PLAN_FEATURE_DESCRIPTIONS,
  PLAN_FEATURE_LABELS,
  PLAN_KEYS,
  planFeatureEnabled,
  type PlanFeature,
} from '@/modules/super-admin/plans';

/**
 * The page a company sees where a feature its package does not include would
 * have been (migration 0065, `src/lib/entitlements.ts`).
 *
 * WHY THIS IS A WHOLE PAGE AND NOT A BANNER
 * -----------------------------------------
 * The alternative to gating a page is not showing it, and a link in the sidebar
 * that leads to a 404 — or worse, a screen with the buttons removed and no
 * explanation — reads as a broken product rather than a package boundary. So the
 * heading still says where you are, and the card underneath answers the three
 * questions somebody who just clicked a menu item actually has: what is this,
 * why can I not use it, and what do I do about it.
 *
 * WHY IT NAMES A PACKAGE BUT NOT A PRICE
 * --------------------------------------
 * The plan catalogue in this file is the only place that knows which package
 * grants which feature, but prices are edited at runtime in `billing_plans` and
 * the two drift. Quoting a stale number to a customer about to spend money is
 * worse than not quoting one, so the copy names the package and sends them to
 * Billing, where the live price and the package picker already live.
 *
 * This is a server component on purpose — it renders inside gated pages, and
 * nothing about it is interactive.
 */

/**
 * The cheapest package a customer could buy today that includes `feature`.
 *
 * Only priced packages count. `custom` grants everything because it is
 * negotiated one company at a time, and `free_trial` costs nothing — naming
 * either as "the package that includes this" would send someone to Billing to
 * look for a button that is not there. When nothing priced includes the feature
 * (agency sub-accounts, deliberately) the answer is null and the copy switches
 * to the honest version: this one is arranged by hand.
 */
function cheapestPackageIncluding(feature: PlanFeature): string | null {
  const affordable = PLAN_KEYS.filter(
    (key) => PLANS[key].priceMonthly > 0 && planFeatureEnabled(key, feature),
  ).sort((a, b) => PLANS[a].priceMonthly - PLANS[b].priceMonthly);
  const cheapest = affordable[0];
  return cheapest ? PLANS[cheapest].label : null;
}

export interface UpgradeNoticeProps {
  feature: PlanFeature;
  /**
   * Page heading. Defaults to the feature's own name, which is the sidebar word
   * — the user clicked it a moment ago, so it has to be the word they see next.
   */
  title?: React.ReactNode;
  /** Same back-link the real page carries, so the gated version is not a trap. */
  backTo?: { href: string; label: string };
}

export function UpgradeNotice({ feature, title, backTo }: UpgradeNoticeProps) {
  const label = PLAN_FEATURE_LABELS[feature];
  const packageLabel = cheapestPackageIncluding(feature);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        backTo={backTo}
        title={title ?? label}
        description={PLAN_FEATURE_DESCRIPTIONS[feature]}
      />

      <Card>
        <CardHeader>
          {/* The wording sidesteps number agreement on purpose: the feature
              names are a mix of singular and plural ("WhatsApp", "Guided
              chats"), so the sentence has to work with the label dropped in
              rather than read around it. */}
          <CardTitle>Not included in your package</CardTitle>
          <CardDescription>
            {packageLabel
              ? `${label} comes with the ${packageLabel} package, and every package above it.`
              : `${label} is arranged with our team rather than bought from the package list.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">{PLAN_FEATURE_DESCRIPTIONS[feature]}</p>

          <p className="text-muted-foreground">
            {packageLabel
              ? 'Your billing page lists what every package costs and what it includes, and you can change package there yourself.'
              : 'Your billing page shows what your account includes today. Ask us about adding this one and we can switch it on without changing your package.'}
          </p>

          {/* An exception is a real, supported answer — `feature_overrides` in
              migration 0065 exists for exactly this — so somebody who has
              already agreed one with us should not be told to buy again. */}
          <p className="text-muted-foreground">
            Already arranged this with us? Ask support to add it to your account and it will appear
            here without a package change.
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild size="sm">
              <Link href="/company/billing">See packages and prices</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
