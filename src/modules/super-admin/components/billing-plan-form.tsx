'use client';

import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { saveBillingPlanAction, type BillingMapState } from '../billing-actions';
import type { BillingPlan } from '../billing-data';

const initial: BillingMapState = {};

export function BillingPlanForm({ plan }: { plan?: BillingPlan }) {
  const [state, action] = useFormState(saveBillingPlanAction, initial);
  // The Packages card renders one of these per plan plus a blank "create" copy,
  // so every generated id is namespaced — `FormField` wires label→control by id
  // and duplicates would point several labels at the first form's inputs.
  const uid = (field: string) => `plan-${plan?.key ?? 'new'}-${field}`;

  return (
    <form action={action} className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-6">
      <input type="hidden" name="key" value={plan?.key ?? ''} />
      <FormField label="Package name" htmlFor={uid('label')} className="sm:col-span-2">
        <Input name="label" defaultValue={plan?.label ?? ''} placeholder="Business Plus" required />
      </FormField>
      <FormField label="Monthly £" htmlFor={uid('priceMonthlyGbp')}>
        <Input
          name="priceMonthlyGbp"
          type="number"
          min={0}
          step="0.01"
          defaultValue={plan?.priceMonthlyGbp ?? ''}
          required
        />
      </FormField>
      <FormField label="Messages" htmlFor={uid('messageLimit')}>
        <Input
          name="messageLimit"
          type="number"
          min={0}
          defaultValue={plan?.messageLimit ?? ''}
          placeholder="500"
        />
      </FormField>
      <FormField label="Assistants" htmlFor={uid('botLimit')}>
        <Input
          name="botLimit"
          type="number"
          min={0}
          defaultValue={plan?.botLimit ?? ''}
          placeholder="1"
        />
      </FormField>
      <FormField label="Team seats" htmlFor={uid('agentLimit')}>
        <Input
          name="agentLimit"
          type="number"
          min={0}
          defaultValue={plan?.agentLimit ?? ''}
          placeholder="1"
        />
      </FormField>
      <FormField label="Integrations" htmlFor={uid('integrationLimit')}>
        <Input
          name="integrationLimit"
          type="number"
          min={0}
          defaultValue={plan?.integrationLimit ?? ''}
          placeholder="0"
        />
      </FormField>
      <FormField label="Included AI credit £" htmlFor={uid('includedCreditGbp')}>
        <Input
          name="includedCreditGbp"
          type="number"
          min={0}
          step="0.01"
          defaultValue={plan?.includedCreditGbp ?? ''}
        />
      </FormField>
      <FormField label="Trial days" htmlFor={uid('trialDays')}>
        <Input name="trialDays" type="number" min={0} defaultValue={plan?.trialDays ?? ''} />
      </FormField>
      <FormField label="Sort" htmlFor={uid('sortOrder')}>
        <Input name="sortOrder" type="number" defaultValue={plan?.sortOrder ?? 100} />
      </FormField>
      <FormField label="Description" htmlFor={uid('description')} className="sm:col-span-2">
        <Input
          name="description"
          defaultValue={plan?.description ?? ''}
          placeholder="Who this package is for"
        />
      </FormField>
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
        <FormMessage state={state} className="mb-2" />
        <SubmitButton pendingLabel="Saving...">Save package</SubmitButton>
      </div>
    </form>
  );
}
