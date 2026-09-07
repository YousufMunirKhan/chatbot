'use client';

import { useEffect, useRef } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { createCannedResponseAction, type ActionState } from '../inbox-actions';

const initial: ActionState = {};

export function CannedResponseForm() {
  const [state, action] = useFormState(createCannedResponseAction, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <FormField label="Title" htmlFor="title">
        <Input name="title" required maxLength={120} placeholder="e.g. Refund policy" />
      </FormField>
      <FormField label="Reply text" htmlFor="body">
        <Textarea
          name="body"
          required
          rows={3}
          maxLength={4000}
          placeholder="The message agents can insert with one click."
        />
      </FormField>
      {/* This form resets on success rather than confirming in place, so the
          live region carries the failure branch only. */}
      <FormMessage state={{ error: state.error }} />
      <SubmitButton>Add saved reply</SubmitButton>
    </form>
  );
}
