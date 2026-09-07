'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';
import { updateSubscriptionAction, type ActionState } from '../actions';
import {
  PLAN_FEATURES,
  PLAN_FEATURE_DESCRIPTIONS,
  PLAN_FEATURE_LABELS,
  SUBSCRIPTION_STATUSES,
  planFeatureEnabled,
  type PlanFeature,
  type PlanFeatureSet,
} from '../plans';
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

/**
 * One feature entitlement, as inherit / force on / force off.
 *
 * This is the control that replaces hand-written SQL. The exception it writes —
 * `subscriptions.feature_overrides`, migration 0065 — has three states and not
 * two: "this company follows its package", "this company has it whatever the
 * package says", and "this company does not have it whatever the package says".
 * A plain checkbox can only carry two, and the missing one is the common case,
 * so this is three radios rather than a tick box. `LimitField` above splits
 * "unlimited" out of a number field for the same reason.
 *
 * The inherit option prints what the selected package would decide, because
 * "inherit" on its own does not tell an operator what they are about to leave
 * this company with — and the answer changes as they change the package above.
 *
 * The hidden `_was` field carries the state this control OPENED in. The action
 * uses it to tell "the operator chose inherit" apart from "the operator did not
 * touch this row", and so never clears an override that was already there
 * because a form rendered before the read was wired said nothing about it.
 */
const OVERRIDE_CHOICES = [
  { value: 'inherit', label: 'Inherit' },
  { value: 'on', label: 'Force on' },
  { value: 'off', label: 'Force off' },
] as const;

type OverrideChoice = (typeof OVERRIDE_CHOICES)[number]['value'];

function choiceOf(value: boolean | undefined): OverrideChoice {
  if (value === true) return 'on';
  if (value === false) return 'off';
  return 'inherit';
}

function FeatureOverrideField({
  feature,
  planKey,
  stored,
}: {
  feature: PlanFeature;
  planKey: string;
  stored: boolean | undefined;
}) {
  // Pinned at mount: the state the row was in when this form was drawn.
  const [openedAs] = useState<OverrideChoice>(() => choiceOf(stored));
  const [choice, setChoice] = useState<OverrideChoice>(openedAs);
  const planGrants = planFeatureEnabled(planKey, feature);

  return (
    <fieldset className="rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{PLAN_FEATURE_LABELS[feature]}</legend>
      <p className="text-xs text-muted-foreground">{PLAN_FEATURE_DESCRIPTIONS[feature]}</p>
      <input type="hidden" name={`feature_${feature}_was`} value={openedAs} />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {OVERRIDE_CHOICES.map((option) => (
          <label key={option.value} className="flex items-center gap-1.5 text-xs">
            <input
              type="radio"
              name={`feature_${feature}`}
              value={option.value}
              checked={choice === option.value}
              onChange={() => setChoice(option.value)}
              className="h-3.5 w-3.5"
            />
            {option.value === 'inherit'
              ? `Inherit — ${planGrants ? 'included' : 'not included'}`
              : option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SubscriptionForm({
  companyId,
  subscription,
  plans,
  featureOverrides,
}: {
  companyId: string;
  subscription: SubscriptionInfo;
  plans: BillingPlan[];
  /**
   * The company's stored `feature_overrides`, so the controls open in the state
   * the row is actually in. Optional because the page that renders this form
   * does not pass it yet; until it does the controls open on "Inherit" and the
   * action leaves untouched rows alone, so nothing an operator set by hand is
   * lost by saving an unrelated change on this form.
   */
  featureOverrides?: PlanFeatureSet;
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

      {/* Migration 0065 — the per-company exception to the package. It sits
          under the limits because it answers the same question one step
          further out: the boxes above say how much of the product this company
          gets, these say which parts of it they get at all. */}
      <div className="space-y-3 border-t pt-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">Feature exceptions</p>
          <p className="text-xs text-muted-foreground">
            Leave every one on <em>Inherit</em> and this company follows its package exactly.
            Forcing one on or off overrides the package for this company only — use it for a
            grandfathered customer or something agreed outside the price list. The company sees the
            result on its own billing page, labelled &ldquo;Added for you&rdquo;.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {PLAN_FEATURES.map((feature) => (
            <FeatureOverrideField
              key={feature}
              feature={feature}
              planKey={planKey}
              stored={featureOverrides?.[feature]}
            />
          ))}
        </div>
      </div>

      <FormMessage state={state} />
      <SubmitButton size="sm">Save changes</SubmitButton>
    </form>
  );
}
