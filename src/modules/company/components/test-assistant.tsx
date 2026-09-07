'use client';

import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
        <p className="text-sm text-muted-foreground">
          Ask a question the way a customer would. Not sure it answers right? Add the missing
          knowledge, then ask again here to see it improve — before customers do.
        </p>
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
        {state.answer ? (
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Assistant answered
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{state.answer}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
