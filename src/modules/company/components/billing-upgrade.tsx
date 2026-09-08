'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BillingPlan } from '@/modules/super-admin/billing-data';
import { CHOICE_GRID } from './form-layout';

function gbp(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

function lim(value: number | null) {
  return value == null ? 'Unlimited' : value.toLocaleString();
}

export function BillingUpgrade({
  plans,
  currentPlan,
}: {
  plans: BillingPlan[];
  currentPlan?: string | null;
}) {
  const availablePlans = useMemo(() => plans.filter((item) => item.key !== 'free_trial'), [plans]);
  const firstPlan =
    availablePlans.find((item) => item.key !== currentPlan)?.key ?? availablePlans[0]?.key ?? '';
  const [plan, setPlan] = useState(firstPlan);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function startCheckout() {
    if (!plan) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const j = (await res.json()) as { url?: string; error?: string };
      if (j.url) {
        window.location.href = j.url;
      } else {
        setError(j.error ?? 'Could not start checkout.');
      }
    } catch {
      setError('Could not reach the checkout service.');
    } finally {
      setLoading(false);
    }
  }

  const chosen = availablePlans.find((item) => item.key === plan);

  return (
    <div className="space-y-4">
      {/*
        A RADIO GROUP THAT SAYS SO
        --------------------------
        These are one choice out of several, but they were plain buttons: no
        `role`, no `aria-checked`, no group name. A keyboard user tabbed through
        every package one at a time and a screen reader announced five unrelated
        buttons with no indication that picking one deselected the others, or
        which one was picked. `radiogroup` + `radio` is what the control has
        always been; this is only saying it out loud.

        `CHOICE_GRID` instead of `sm:grid-cols-2 lg:grid-cols-3`: the packages
        card is full width on `/company/billing`, but this component is a plain
        export and the next screen to show it will not be. `auto-fit` is right
        in both places.
      */}
      <div role="radiogroup" aria-label="Choose a package" className={CHOICE_GRID}>
        {availablePlans.map((item) => {
          const isCurrent = item.key === currentPlan;
          const isChosen = plan === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="radio"
              aria-checked={isChosen}
              onClick={() => setPlan(item.key)}
              disabled={isCurrent}
              className={cn(
                'rounded-md border p-3 text-start text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-60',
                isChosen ? 'border-primary bg-primary/5' : 'hover:border-primary/50',
              )}
            >
              <span className="block font-medium">{item.label}</span>
              <span className="block text-muted-foreground">
                {gbp(item.priceMonthlyGbp)}/mo
              </span>
              <span className="mt-2 block text-xs text-muted-foreground">
                {lim(item.messageLimit)} messages/month
              </span>
              {isCurrent ? (
                // Was `text-emerald-700`: a raw palette green that is not
                // defined in dark mode at all. `Badge variant="success"` is the
                // token-backed version, and it also stops this one line being
                // the only status in the product that is not a badge.
                <Badge variant="success" className="mt-2">
                  Your package now
                </Badge>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* `role="alert"`: this is the result of pressing the button below, so it
          appears after the user acts and has to be announced. It was a silent
          paragraph. */}
      {error ? (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      ) : null}

      {/* "Upgrade / start checkout" was two labels with a slash between them,
          and it was not always an upgrade. The button now names the package it
          is about to take you to pay for, and says where it is taking you. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={startCheckout} disabled={loading || !plan} aria-busy={loading}>
          {loading ? 'Opening Stripe…' : `Continue to payment${chosen ? ` — ${chosen.label}` : ''}`}
        </Button>
        <p className="text-xs text-muted-foreground">
          Opens Stripe&rsquo;s secure checkout. Nothing changes until you pay there.
        </p>
      </div>
    </div>
  );
}
