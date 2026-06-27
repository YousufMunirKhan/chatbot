'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { testAssistantAction, type TestAssistantState } from '../test-assistant-actions';

const initial: TestAssistantState = {};

function AskButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="shrink-0">
      {pending ? 'Asking…' : 'Ask'}
    </Button>
  );
}

/** Company-facing live test — verify changes by asking the assistant directly. */
export function TestAssistant() {
  const [state, action] = useFormState(testAssistantAction, initial);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Test your assistant</CardTitle>
        <p className="text-sm text-muted-foreground">
          Ask a question the way a customer would. Not sure it answers right? Add the missing knowledge, then ask
          again here to see it improve — before customers do.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <form action={action} className="flex flex-col gap-2 sm:flex-row">
          <Input name="question" placeholder="e.g. How much is your starter package?" className="flex-1" />
          <AskButton />
        </form>
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
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
