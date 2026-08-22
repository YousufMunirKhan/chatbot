'use client';

import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';
import { grantCompanyRepliesAction, type ActionState } from '../actions';

const initial: ActionState = {};

/** Grant extra AI replies on top of the plan allowance (Module 4). */
export function ReplyGrantForm({ companyId }: { companyId: string }) {
  const [state, action] = useFormState(grantCompanyRepliesAction, initial);

  return (
    <form action={action} className="space-y-3 rounded-md border bg-muted/20 p-3">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid gap-3 lg:grid-cols-[140px_170px_minmax(0,1fr)_170px_auto]">
        <FormField label="Extra replies" htmlFor="replyCount">
          <Input id="replyCount" name="replyCount" type="number" min={1} placeholder="200" required />
        </FormField>
        <FormField label="Type" htmlFor="grantType">
          <Select id="grantType" name="grantType" defaultValue="goodwill">
            <option value="goodwill">Goodwill bonus</option>
            <option value="paid_extra">Paid extra replies</option>
            <option value="support_adjustment">Support adjustment</option>
            <option value="manual">Manual</option>
          </Select>
        </FormField>
        <FormField label="Note" htmlFor="reason">
          <Input
            id="reason"
            name="reason"
            placeholder="Customer requested a one-off allowance"
            required
          />
        </FormField>
        <FormField label="Expires" htmlFor="expiresAt">
          <Input id="expiresAt" name="expiresAt" type="date" />
        </FormField>
        <div className="flex items-end">
          <SubmitButton size="sm" pendingLabel="Adding…">
            Add replies
          </SubmitButton>
        </div>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
