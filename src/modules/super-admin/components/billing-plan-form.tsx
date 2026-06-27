'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveBillingPlanAction, type BillingMapState } from '../billing-actions';
import type { BillingPlan } from '../billing-data';

const initial: BillingMapState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving...' : 'Save package'}
    </Button>
  );
}

export function BillingPlanForm({ plan }: { plan?: BillingPlan }) {
  const [state, action] = useFormState(saveBillingPlanAction, initial);
  return (
    <form action={action} className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-6">
      <input type="hidden" name="key" value={plan?.key ?? ''} />
      <div className="space-y-1.5 sm:col-span-2">
        <Label>Package name</Label>
        <Input name="label" defaultValue={plan?.label ?? ''} placeholder="Business Plus" required />
      </div>
      <div className="space-y-1.5">
        <Label>Monthly £</Label>
        <Input
          name="priceMonthlyGbp"
          type="number"
          min={0}
          step="0.01"
          defaultValue={plan?.priceMonthlyGbp ?? ''}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label>Messages</Label>
        <Input
          name="messageLimit"
          type="number"
          min={0}
          defaultValue={plan?.messageLimit ?? ''}
          placeholder="500"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Assistants</Label>
        <Input
          name="botLimit"
          type="number"
          min={0}
          defaultValue={plan?.botLimit ?? ''}
          placeholder="1"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Team seats</Label>
        <Input
          name="agentLimit"
          type="number"
          min={0}
          defaultValue={plan?.agentLimit ?? ''}
          placeholder="1"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Integrations</Label>
        <Input
          name="integrationLimit"
          type="number"
          min={0}
          defaultValue={plan?.integrationLimit ?? ''}
          placeholder="0"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Included AI credit £</Label>
        <Input
          name="includedCreditGbp"
          type="number"
          min={0}
          step="0.01"
          defaultValue={plan?.includedCreditGbp ?? ''}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Trial days</Label>
        <Input name="trialDays" type="number" min={0} defaultValue={plan?.trialDays ?? ''} />
      </div>
      <div className="space-y-1.5">
        <Label>Sort</Label>
        <Input name="sortOrder" type="number" defaultValue={plan?.sortOrder ?? 100} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label>Description</Label>
        <Input
          name="description"
          defaultValue={plan?.description ?? ''}
          placeholder="Who this package is for"
        />
      </div>
      <label className="flex items-center gap-2 pt-7 text-sm">
        <input
          type="checkbox"
          name="isPublic"
          defaultChecked={plan?.isPublic ?? true}
          className="h-4 w-4"
        />
        Public
      </label>
      <label className="flex items-center gap-2 pt-7 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={plan?.isActive ?? true}
          className="h-4 w-4"
        />
        Active
      </label>
      <div className="sm:col-span-6">
        {state.error ? <p className="mb-2 text-sm text-destructive">{state.error}</p> : null}
        {state.ok ? <p className="mb-2 text-sm text-emerald-600">Saved.</p> : null}
        <Submit />
      </div>
    </form>
  );
}
