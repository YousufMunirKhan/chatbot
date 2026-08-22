'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';
import { updateSubscriptionAction, type ActionState } from '../actions';
import { SUBSCRIPTION_STATUSES } from '../plans';
import type { BillingPlan } from '../billing-data';
import type { SubscriptionInfo } from '../data';

const initial: ActionState = {};

/**
 * One plan limit, as an explicit three-state control.
 *
 * A single number input cannot express "unlimited", "the plan default", and "this
 * exact number" at once — which is how blanking a field came to mean the plan
 * default on the onboarding form and `null` (unlimited) here. The checkbox
 * separates unlimited out, so a blank box now means the same thing on both forms.
 */
function LimitField({
  name,
  label,
  value,
  planDefault,
}: {
  name: string;
  label: string;
  value: number | null;
  planDefault: number | null;
}) {
  // A stored `null` is what "unlimited" looks like in the column, so the control
  // opens in the state the row is actually in.
  const [unlimited, setUnlimited] = useState(value == null);
  const [entered, setEntered] = useState(value == null ? '' : String(value));

  return (
    <div className="space-y-1.5">
      <FormField label={label} htmlFor={name}>
        <Input
          id={name}
          name={name}
          type="number"
          min={0}
          step={1}
          disabled={unlimited}
          value={unlimited ? '' : entered}
          onChange={(event) => setEntered(event.target.value)}
          placeholder={planDefault == null ? 'Plan default: unlimited' : `Plan default: ${planDefault}`}
        />
      </FormField>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          name={`${name}Unlimited`}
          checked={unlimited}
          onChange={(event) => setUnlimited(event.target.checked)}
          className="h-3.5 w-3.5"
        />
        Unlimited
      </label>
    </div>
  );
}

export function SubscriptionForm({
  companyId,
  subscription,
  plans,
}: {
  companyId: string;
  subscription: SubscriptionInfo;
  plans: BillingPlan[];
}) {
  const [state, action] = useFormState(updateSubscriptionAction, initial);
  const [planKey, setPlanKey] = useState(subscription.plan ?? plans[0]?.key ?? 'free_trial');
  const selectedPlan = plans.find((plan) => plan.key === planKey) ?? null;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Plan" htmlFor="plan">
          <Select
            id="plan"
            name="plan"
            value={planKey}
            onChange={(event) => setPlanKey(event.target.value)}
          >
            {plans.map((plan) => (
              <option key={plan.key} value={plan.key}>
                {plan.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={subscription.status ?? 'trialing'}>
            {SUBSCRIPTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="Free until"
          htmlFor="freeUntil"
          hint="Shown to the company on their billing page. It does not currently waive limits or billing on its own."
        >
          <Input
            id="freeUntil"
            name="freeUntil"
            type="date"
            defaultValue={subscription.freeUntil ?? ''}
          />
        </FormField>
        <LimitField
          name="messageLimit"
          label="Monthly AI replies"
          value={subscription.messageLimit}
          planDefault={selectedPlan?.messageLimit ?? null}
        />
        <LimitField
          name="agentLimit"
          label="Team seats"
          value={subscription.agentLimit}
          planDefault={selectedPlan?.agentLimit ?? null}
        />
        <LimitField
          name="botLimit"
          label="Assistants"
          value={subscription.botLimit}
          planDefault={selectedPlan?.botLimit ?? null}
        />
        <LimitField
          name="integrationLimit"
          label="Integrations"
          value={subscription.integrationLimit}
          planDefault={selectedPlan?.integrationLimit ?? null}
        />
      </div>

      <p className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        <strong className="font-medium text-foreground">How limits are read:</strong> a number is
        used exactly as typed (<code>0</code> is a valid limit and blocks the feature). Leave a box
        blank to inherit the selected plan&apos;s default. Tick <em>Unlimited</em> to remove the cap
        entirely — the same rule the onboarding form uses.
      </p>

      <FormMessage state={state} />
      <SubmitButton size="sm">Save changes</SubmitButton>
    </form>
  );
}
