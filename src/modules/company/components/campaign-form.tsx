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
      <FormField
        label="Name this invite"
        htmlFor="name"
        required
        hint="Only you see this — it is how you will find it in the list."
      >
        <Input name="name" required maxLength={120} placeholder="Pricing page nudge" />
      </FormField>
      <FormField
        label="What it says to them"
        htmlFor="message"
        required
        hint="One short line. It appears as the assistant's first message when the chat opens itself."
      >
        <Textarea
          name="message"
          required
          rows={2}
          maxLength={500}
          placeholder="Have a question about pricing? I can help."
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Only on pages whose address contains"
          htmlFor="matchUrl"
          hint="A fragment of the address, not a whole link — /pricing matches yourshop.com/pricing. Leave it empty to use this invite on every page."
        >
          <Input name="matchUrl" placeholder="/pricing" />
        </FormField>
        <FormField
          label="Wait this long first"
          htmlFor="delaySeconds"
          hint="Seconds after the page loads. Long enough that they have started reading; 8 is a reasonable start."
        >
          <Input
            name="delaySeconds"
            type="number"
            inputMode="numeric"
            min={0}
            max={600}
            defaultValue={8}
          />
        </FormField>
      </div>
      {/*
        "Open the chat automatically with this message" was a checkbox that
        decided nothing. `scheduleProactiveCampaign` in public/widget/widget.js
        (:1260-1280) reads `message`, `matchUrl` and `delaySeconds` off the rule
        and then calls `openWidget(true)` unconditionally — `rule.autoOpen` is
        never looked at. Unticking it produced a chat invite that opened the
        chat anyway.

        Opening the chat IS what a chat invite is, so there is no second
        behaviour to offer. The stored `auto_open` column is kept true rather
        than dropped, so nothing about existing rows changes.
      */}
      <input type="hidden" name="autoOpen" value="on" />
      <p className="text-xs text-muted-foreground">
        A chat invite always opens the chat itself with this message — that is what makes it an
        invite rather than a chat button. Use Chat buttons instead if you only want something
        waiting for them to tap.
      </p>
      <FormMessage state={state} okText="Chat invite saved." />
      <SubmitButton>Create this invite</SubmitButton>
    </form>
  );
}
