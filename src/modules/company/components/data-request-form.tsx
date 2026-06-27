'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createDataRequestAction, type ActionState } from '../settings-actions';

const initial: ActionState = {};
const selectCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Submit() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Submitting...' : 'Submit request'}</Button>;
}

export function DataRequestForm() {
  const [state, action] = useFormState(createDataRequestAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input name="requesterEmail" type="email" required />
        </div>
        <div className="space-y-1.5">
          <Label>Request</Label>
          <select name="requestType" className={selectCls}>
            <option value="export">Export data</option>
            <option value="delete">Delete data</option>
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" placeholder="Optional details about the request" rows={3} />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Request submitted.</p> : null}
      <Submit />
    </form>
  );
}
