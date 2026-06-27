'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveAiControlsAction, type AiControlsState } from '../ai-controls-actions';

const initial: AiControlsState = {};

function Submit() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Saving...' : 'Save AI controls'}</Button>;
}

export function AiControlsForm({ monthlyBudgetUsd, hardStopEnabled, cacheEnabled }: {
  monthlyBudgetUsd: number | null;
  hardStopEnabled: boolean;
  cacheEnabled: boolean;
}) {
  const [state, action] = useFormState(saveAiControlsAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Monthly AI spend limit</Label>
          <Input
            name="monthlyBudgetUsd"
            type="number"
            step="0.01"
            min="0"
            list="ai-budget-presets"
            defaultValue={monthlyBudgetUsd ?? ''}
            placeholder="No limit"
          />
          <datalist id="ai-budget-presets">
            {[25, 50, 100, 250, 500, 1000].map((amount) => (
              <option key={amount} value={amount} />
            ))}
          </datalist>
        </div>
        <label className="flex items-center gap-2 pt-7 text-sm">
          <input type="checkbox" name="hardStopEnabled" defaultChecked={hardStopEnabled} className="h-4 w-4" />
          Stop AI replies at the limit
        </label>
        <label className="flex items-center gap-2 pt-7 text-sm">
          <input type="checkbox" name="cacheEnabled" defaultChecked={cacheEnabled} className="h-4 w-4" />
          Reuse repeated answers to reduce cost
        </label>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Saved.</p> : null}
      <Submit />
    </form>
  );
}
