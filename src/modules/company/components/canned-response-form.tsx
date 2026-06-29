'use client';

import { useEffect, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { createCannedResponseAction, type ActionState } from '../inbox-actions';

const initial: ActionState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Add saved reply'}
    </Button>
  );
}

export function CannedResponseForm() {
  const [state, action] = useFormState(createCannedResponseAction, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required maxLength={120} placeholder="e.g. Refund policy" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="body">Reply text</Label>
        <Textarea id="body" name="body" required rows={3} maxLength={4000} placeholder="The message agents can insert with one click." />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Submit />
    </form>
  );
}
