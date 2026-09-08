'use client';

import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { saveAiControlsAction, type AiControlsState } from '../ai-controls-actions';
import { CHECKBOX, CHOICE_CARD, CHOICE_GRID } from './form-layout';

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
    <form action={action} className="space-y-6">
      {/*
        WHAT WAS WRONG WITH THE OLD SHAPE
        ---------------------------------
        One `sm:grid-cols-3` row held the spend limit and both tick boxes, and
        the two tick boxes were pushed onto the input's baseline with `pt-7` —
        a magic number equal to the height of a one-line label. The moment the
        limit's label wrapped (it does at any width below about 300px, and this
        page is `max-w-3xl`), the boxes sat 20px too high. Worse, the limit's
        hint is four sentences long, so the grid row was as tall as that hint
        and the two tick boxes floated in the middle of a column of white space
        with no visible relationship to anything.

        They are not three peers. One is a number; the other two are what
        happens when you reach it. So: the number first, then a fieldset saying
        so, which is also what a screen reader now announces.
      */}
      <FormField
        label="Monthly AI spend limit (US$)"
        htmlFor="monthlyBudgetUsd"
        hint="What you are willing to spend on assistant replies each calendar month. Leave it empty for no limit at all."
      >
        {/* The currency belongs in the label, not in a footnote: the column is
            `monthly_budget_usd` and the figure above this form is rendered with
            formatCurrency(…, 'USD'), so a number typed here is dollars whatever
            the shop bills its own customers in.

            `max-w-xs` because a currency amount is four characters wide; a
            full-width money box reads as though a long value is expected. */}
        <Input
          name="monthlyBudgetUsd"
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          list="ai-budget-presets"
          className="max-w-xs"
          defaultValue={monthlyBudgetUsd ?? ''}
          placeholder="No limit"
        />
      </FormField>
      <datalist id="ai-budget-presets">
        {[25, 50, 100, 250, 500, 1000].map((amount) => (
          <option key={amount} value={amount} />
        ))}
      </datalist>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">When you reach that limit</legend>
        <div className={CHOICE_GRID}>
          <label className={CHOICE_CARD}>
            <input
              type="checkbox"
              name="hardStopEnabled"
              defaultChecked={hardStopEnabled}
              className={CHECKBOX}
            />
            <span>
              <span className="block font-medium">Stop AI replies at the limit</span>
              <span className="block text-xs text-muted-foreground">
                Your assistant goes quiet until the next month starts, and your team answers by
                hand. Leave it off to keep replying and overspend.
              </span>
            </span>
          </label>
          <label className={CHOICE_CARD}>
            <input
              type="checkbox"
              name="cacheEnabled"
              defaultChecked={cacheEnabled}
              className={CHECKBOX}
            />
            <span>
              <span className="block font-medium">Reuse repeated answers</span>
              <span className="block text-xs text-muted-foreground">
                When two customers ask the same thing, the second one gets the answer already
                worked out. Cheaper, and faster for them.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving…">Save spending limits</SubmitButton>
    </form>
  );
}
