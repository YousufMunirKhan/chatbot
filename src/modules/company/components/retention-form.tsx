'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { updateRetentionAction, type ActionState } from '../settings-actions';

const initial: ActionState = {};
const selectCls =
  'flex h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </Button>
  );
}

export function RetentionForm({ current }: { current: number }) {
  const [state, action] = useFormState(updateRetentionAction, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="retentionDays">Retention period (days)</Label>
        <select id="retentionDays" name="retentionDays" className={selectCls} defaultValue={current}>
          {[30, 60, 90, 180, 365, 730, 1095].includes(current) ? null : (
            <option value={current}>{current} days</option>
          )}
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
          <option value={180}>6 months</option>
          <option value={365}>1 year</option>
          <option value={730}>2 years</option>
          <option value={1095}>3 years</option>
        </select>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Saved.</p> : null}
      <Save />
    </form>
  );
}
