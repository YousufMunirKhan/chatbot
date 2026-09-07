'use client';

import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { saveAiControlsAction, type AiControlsState } from '../ai-controls-actions';

const initial: AiControlsState = {};

export function AiControlsForm({
  monthlyBudgetUsd,
  hardStopEnabled,
  cacheEnabled,
}: {
  monthlyBudgetUsd: number | null;
  hardStopEnabled: boolean;
  cacheEnabled: boolean;
}) {
  const [state, action] = useFormState(saveAiControlsAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {/* The currency belongs in the label, not in a footnote: the column is
            `monthly_budget_usd` and the figure above this form is rendered with
            formatCurrency(…, 'USD'), so a number typed here is dollars whatever
            the shop bills its own customers in. */}
        <FormField
          label="Monthly AI spend limit (US$)"
          htmlFor="monthlyBudgetUsd"
          hint="What you are willing to spend on assistant replies each calendar month. At the limit we either stop the assistant replying or keep going and let you overspend — the box next to this decides which. Leave it empty for no limit at all."
        >
          <Input
            name="monthlyBudgetUsd"
            type="number"
            step="0.01"
            min="0"
            list="ai-budget-presets"
            defaultValue={monthlyBudgetUsd ?? ''}
            placeholder="No limit"
          />
        </FormField>
        <datalist id="ai-budget-presets">
          {[25, 50, 100, 250, 500, 1000].map((amount) => (
            <option key={amount} value={amount} />
          ))}
        </datalist>
        <label className="flex items-center gap-2 pt-7 text-sm">
          <input
            type="checkbox"
            name="hardStopEnabled"
            defaultChecked={hardStopEnabled}
            className="h-4 w-4"
          />
          Stop AI replies at the limit
        </label>
        <label className="flex items-center gap-2 pt-7 text-sm">
          <input
            type="checkbox"
            name="cacheEnabled"
            defaultChecked={cacheEnabled}
            className="h-4 w-4"
          />
          Reuse repeated answers to reduce cost
        </label>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving...">Save AI controls</SubmitButton>
    </form>
  );
}
