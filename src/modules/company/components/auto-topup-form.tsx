'use client';

import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { FIELD_GRID } from './form-layout';
import type { AutoTopUpConfig } from '@/lib/billing/auto-topup';
import {
  runAutoTopUpNowAction,
  saveAutoTopUpAction,
  type ActionState,
} from '../auto-topup-actions';

const initial: ActionState = {};

export interface AutoTopUpFormProps {
  config: AutoTopUpConfig | null;
  /** Current prepaid credit, so the threshold can be judged against something. */
  balance: number | null;
}

/**
 * Enable auto top-up and set its threshold and amount.
 *
 * The payment method is an id, not a card form: this application never touches
 * card numbers. The id comes from Stripe's own hosted setup (Billing Portal or
 * a SetupIntent), which is also where the card is stored.
 */
export function AutoTopUpForm({ config, balance }: AutoTopUpFormProps) {
  const [state, action] = useFormState(saveAutoTopUpAction, initial);
  const [runState, runAction] = useFormState(runAutoTopUpNowAction, initial);

  const enabled = config?.isEnabled ?? false;
  const threshold = config?.thresholdCredits ?? 5;
  const amount = ((config?.topupAmountCents ?? 2000) / 100).toFixed(2);

  return (
    <div className="space-y-4">
      {config?.disabledReason ? (
        <p
          role="status"
          className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-fg"
        >
          {config.disabledReason}
        </p>
      ) : null}

      <form action={action} className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isEnabled"
            defaultChecked={enabled}
            className="h-4 w-4 rounded border-input"
          />
          Top up automatically when my credit runs low
        </label>

        <div className={FIELD_GRID}>
          <FormField
            label="Top up below (credits)"
            htmlFor="thresholdCredits"
            hint={balance == null ? undefined : `You have ${balance.toFixed(2)} now.`}
          >
            <Input
              id="thresholdCredits"
              name="thresholdCredits"
              type="number"
              min={0}
              step={1}
              defaultValue={threshold}
            />
          </FormField>
          <FormField
            label="Amount (£)"
            htmlFor="topupAmountCents"
            hint="Charged each time. Minimum £1."
          >
            {/* Submitted in pence: the ledger and Stripe both count in the
                smallest unit, and converting in the browser is where rounding
                bugs of exactly one penny come from. */}
            <Input
              id="topupAmountCents"
              name="topupAmountCentsDisplay"
              type="number"
              min={1}
              step="0.01"
              defaultValue={amount}
              onChange={(e) => {
                const hidden = e.currentTarget.form?.elements.namedItem(
                  'topupAmountCents',
                ) as HTMLInputElement | null;
                if (hidden) hidden.value = String(Math.round(Number(e.currentTarget.value) * 100));
              }}
            />
          </FormField>
          <FormField
            label="Stripe payment method"
            htmlFor="stripePaymentMethodId"
            hint="The pm_… id of a card saved on your Stripe customer."
          >
            <Input
              id="stripePaymentMethodId"
              name="stripePaymentMethodId"
              maxLength={100}
              placeholder="pm_1234…"
              defaultValue={config?.stripePaymentMethodId ?? ''}
            />
          </FormField>
        </div>

        <input
          type="hidden"
          name="topupAmountCents"
          defaultValue={config?.topupAmountCents ?? 2000}
        />

        <FormMessage state={state} okText="Auto top-up saved." />
        <SubmitButton pendingLabel="Saving…">Save automatic top-up settings</SubmitButton>
      </form>

      <form action={runAction} className="space-y-2 border-t pt-4">
        <p className="text-sm text-muted-foreground">
          Runs the same check the platform runs. Nothing is charged if your balance is above the
          threshold.
        </p>
        {runState.message ? (
          <p role="status" className="text-sm text-success-fg">
            {runState.message}
          </p>
        ) : (
          <FormMessage state={runState} okText="Checked." />
        )}
        <SubmitButton variant="outline" pendingLabel="Checking…">
          Top up now
        </SubmitButton>
      </form>
    </div>
  );
}
