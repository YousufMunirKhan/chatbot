'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { BillingPlan } from '@/modules/super-admin/billing-data';

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

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {availablePlans.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setPlan(item.key)}
            disabled={item.key === currentPlan}
            className={`rounded-md border p-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
              plan === item.key ? 'border-primary bg-primary/5' : ''
            }`}
          >
            <span className="block font-medium">{item.label}</span>
            <span className="text-muted-foreground">{gbp(item.priceMonthlyGbp)}/mo</span>
            <span className="mt-2 block text-xs text-muted-foreground">
              {lim(item.messageLimit)} messages/month
            </span>
            {item.key === currentPlan ? (
              <span className="mt-2 block text-xs font-medium text-emerald-700">Current plan</span>
            ) : null}
          </button>
        ))}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="button" onClick={startCheckout} disabled={loading || !plan}>
        {loading ? 'Starting...' : 'Upgrade / start checkout'}
      </Button>
    </div>
  );
}
