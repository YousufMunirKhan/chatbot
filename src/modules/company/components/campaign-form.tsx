'use client';

import { useEffect, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { saveCampaignAction, type ActionState } from '../campaigns-actions';

const initial: ActionState = {};

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Create campaign'}
    </Button>
  );
}

export function CampaignForm() {
  const [state, action] = useFormState(saveCampaignAction, initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Campaign name</Label>
        <Input id="name" name="name" required maxLength={120} placeholder="Pricing page nudge" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="message">Message</Label>
        <Textarea id="message" name="message" required rows={2} maxLength={500} placeholder="Have a question about pricing? I can help." />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="matchUrl">Show on pages containing (optional)</Label>
          <Input id="matchUrl" name="matchUrl" placeholder="/pricing" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="delaySeconds">Delay (seconds)</Label>
          <Input id="delaySeconds" name="delaySeconds" type="number" min={0} max={600} defaultValue={8} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="autoOpen" defaultChecked className="h-4 w-4" />
        Open the chat automatically with this message
      </label>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-green-600">Campaign saved.</p> : null}
      <Save />
    </form>
  );
}
