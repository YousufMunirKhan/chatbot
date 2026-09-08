'use client';

import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { testAssistantAction, type TestAssistantState } from '../test-assistant-actions';

const initial: TestAssistantState = {};

/** Company-facing live test — verify changes by asking the assistant directly. */
export function TestAssistant() {
  const [state, action] = useFormState(testAssistantAction, initial);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Test your assistant</CardTitle>
        {/* `CardDescription` written out by hand. Same result today, one more
            place for the two to drift tomorrow — and `CardHeader` already
            supplies the gap this was relying on. */}
        <CardDescription>
          Ask a question the way a customer would. Not sure it answers right? Add the missing
          knowledge, then ask again here to see it improve — before customers do.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <FormField label="Your question" htmlFor="test-question" className="flex-1">
            <Input name="question" placeholder="e.g. How much is your starter package?" />
          </FormField>
          <SubmitButton className="shrink-0" pendingLabel="Asking…">
            Ask the assistant
          </SubmitButton>
        </form>
        {/* Success here is the answer block below, not a confirmation line, so
            this region carries the failure branch only. */}
        <FormMessage state={{ error: state.error }} />
        {/*
          The answer IS the result of this form, and it was arriving silently.
          `FormMessage` above carries only the failure branch (success here is
          the block below, not a "Saved." line), so a screen-reader user pressed
          "Ask the assistant", the answer appeared underneath, and they were
          told nothing at all — the page sounded exactly as it had before.

          The region is rendered unconditionally so assistive tech is already
          watching the node when the text swaps in; a container that appears at
          the same moment as its content is frequently missed. `aria-atomic`
          because the heading and the answer are one announcement, not two.
        */}
        <div role="status" aria-live="polite" aria-atomic="true">
          {state.answer ? (
            <div className="rounded-lg border bg-muted/30 p-4">
              {/* A styled `<div>` in a heading's place puts nothing in the
                  outline. `<h3>`: the card title above it is the `<h2>`. */}
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Assistant answered
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm">{state.answer}</p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
