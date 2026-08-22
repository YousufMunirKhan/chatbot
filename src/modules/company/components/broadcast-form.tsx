'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { createBroadcastAction, type ActionState } from '../broadcasts-actions';

const initial: ActionState = {};

export function BroadcastForm() {
  const [state, action] = useFormState(createBroadcastAction, initial);
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="space-y-4">
      <FormField label="Channel" htmlFor="channel">
        {/* This select was one of two that hand-rolled their classes inline with
            a bare `border` and no focus ring; `Select` gives it `border-input`
            and the standard ring. */}
        <Select
          name="channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value as typeof channel)}
        >
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
        </Select>
      </FormField>

      {channel === 'email' ? (
        <FormField label="Subject" htmlFor="subject">
          <Input name="subject" maxLength={200} />
        </FormField>
      ) : null}

      <FormField label="Message" htmlFor="message">
        <Textarea name="message" required rows={3} maxLength={2000} />
      </FormField>

      <FormField label="Send at (optional — leave blank to send on next run)" htmlFor="scheduleAt">
        <Input name="scheduleAt" type="datetime-local" />
      </FormField>

      <FormMessage state={state} okText="Broadcast scheduled." />
      <SubmitButton pendingLabel="Scheduling…">Schedule broadcast</SubmitButton>
    </form>
  );
}
