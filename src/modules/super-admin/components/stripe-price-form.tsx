'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveStripePriceMappingAction, type BillingMapState } from '../billing-actions';
import type { BillingPlan } from '../billing-data';

const initial: BillingMapState = {};
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving...' : 'Save mapping'}
    </Button>
  );
}

export function StripePriceForm({ plans = [] }: { plans?: BillingPlan[] }) {
  const [state, action] = useFormState(saveStripePriceMappingAction, initial);
  const hasPlans = plans.length > 0;
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-5">
      <div className="space-y-1.5">
        <Label>Plan</Label>
        <select name="plan" className={selectCls} disabled={!hasPlans}>
          {!hasPlans ? <option value="">Create a package first</option> : null}
          {plans.map((plan) => (
            <option key={plan.key} value={plan.key}>
              {plan.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label>Stripe price ID</Label>
        <Input name="stripePriceId" placeholder="price_..." required />
      </div>
      <div className="space-y-1.5">
        <Label>Overage price ID</Label>
        <Input name="overagePriceId" placeholder="price_..." />
      </div>
      <div className="space-y-1.5">
        <label className="mt-8 flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked className="h-4 w-4" />
          Enabled
        </label>
      </div>
      <div className="sm:col-span-5">
        {!hasPlans ? (
          <p className="mb-2 text-sm text-muted-foreground">
            No billing packages are available yet. Save a package above before mapping Stripe.
          </p>
        ) : null}
        {state.error ? <p className="mb-2 text-sm text-destructive">{state.error}</p> : null}
        {state.ok ? <p className="mb-2 text-sm text-emerald-600">Saved.</p> : null}
        {hasPlans ? <Submit /> : null}
      </div>
    </form>
  );
}
