'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { createBroadcastAction, type ActionState } from '../broadcasts-actions';

const initial: ActionState = {};

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Scheduling…' : 'Schedule broadcast'}
    </Button>
  );
}

export function BroadcastForm() {
  const [state, action] = useFormState(createBroadcastAction, initial);
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="channel">Channel</Label>
        <select
          id="channel"
          name="channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value as typeof channel)}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
        </select>
      </div>

      {channel === 'email' ? (
        <div className="space-y-1.5">
          <Label htmlFor="subject">Subject</Label>
          <Input id="subject" name="subject" maxLength={200} />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="message">Message</Label>
        <Textarea id="message" name="message" required rows={3} maxLength={2000} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="scheduleAt">Send at (optional — leave blank to send on next run)</Label>
        <Input id="scheduleAt" name="scheduleAt" type="datetime-local" />
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-green-600">Broadcast scheduled.</p> : null}
      <Save />
    </form>
  );
}
