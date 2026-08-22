'use client';

import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';
import { saveStripePriceMappingAction, type BillingMapState } from '../billing-actions';
import type { BillingPlan } from '../billing-data';

const initial: BillingMapState = {};

export function StripePriceForm({ plans = [] }: { plans?: BillingPlan[] }) {
  const [state, action] = useFormState(saveStripePriceMappingAction, initial);
  const hasPlans = plans.length > 0;
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-5">
      <FormField label="Plan" htmlFor="stripePlan">
        <Select id="stripePlan" name="plan" disabled={!hasPlans}>
          {!hasPlans ? <option value="">Create a package first</option> : null}
          {plans.map((plan) => (
            <option key={plan.key} value={plan.key}>
              {plan.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Stripe price ID" htmlFor="stripePriceId" className="sm:col-span-2">
        <Input id="stripePriceId" name="stripePriceId" placeholder="price_..." required />
      </FormField>
      <FormField label="Overage price ID" htmlFor="overagePriceId">
        <Input id="overagePriceId" name="overagePriceId" placeholder="price_..." />
      </FormField>
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
        <FormMessage state={state} className="mb-2" />
        {hasPlans ? <SubmitButton pendingLabel="Saving...">Save mapping</SubmitButton> : null}
      </div>
    </form>
  );
}
