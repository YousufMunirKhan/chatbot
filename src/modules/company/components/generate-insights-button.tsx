'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { generateInsightsAction } from '@/modules/company/insights-actions';

/**
 * Runs the analysis on demand.
 *
 * It reads several thousand rows and may call the model, so the button reports
 * what came back rather than silently reloading — "nothing worth flagging" is a
 * real and useful answer, and a page that looks unchanged reads as a failure.
 */
export function GenerateInsightsButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            setError(null);
            const result = await generateInsightsAction();
            if (result.error) setError(result.error);
            else setMessage(result.message ?? 'Done.');
          })
        }
      >
        {pending ? 'Reading your conversations…' : 'Check now'}
      </Button>
      {message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
