'use client';

import { useEffect, useRef } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { saveCampaignAction, type ActionState } from '../campaigns-actions';

const initial: ActionState = {};

export function CampaignForm() {
  const [state, action] = useFormState(saveCampaignAction, initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="space-y-4">
      <FormField label="Campaign name" htmlFor="name">
        <Input name="name" required maxLength={120} placeholder="Pricing page nudge" />
      </FormField>
      <FormField label="Message" htmlFor="message">
        <Textarea
          name="message"
          required
          rows={2}
          maxLength={500}
          placeholder="Have a question about pricing? I can help."
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Show on pages containing (optional)" htmlFor="matchUrl">
          <Input name="matchUrl" placeholder="/pricing" />
        </FormField>
        <FormField label="Delay (seconds)" htmlFor="delaySeconds">
          <Input name="delaySeconds" type="number" min={0} max={600} defaultValue={8} />
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="autoOpen" defaultChecked className="h-4 w-4" />
        Open the chat automatically with this message
      </label>
      <FormMessage state={state} okText="Campaign saved." />
      <SubmitButton>Create campaign</SubmitButton>
    </form>
  );
}
