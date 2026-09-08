'use client';

import { useEffect, useState, useTransition } from 'react';
import { useFormState } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';
import { Textarea } from '@/components/ui/textarea';
import {
  acceptFlowSuggestionAction,
  dismissFlowSuggestionAction,
  generateFlowSuggestionsAction,
  type AcceptSuggestionState,
  type ActionState,
} from '../flow-suggestions-actions';

/**
 * The interactive parts of the review screen.
 *
 * Everything else on that page is a server component, including the flow
 * preview — only the three controls below need to hydrate.
 */

/**
 * Look for suggestions now.
 *
 * The run reads thousands of messages and may make model calls, so the button
 * reports what came back instead of silently reloading. "Nothing came up often
 * enough" is a real, useful answer, and a page that looks unchanged after a
 * fifteen-second wait reads as a failure.
 */
export function GenerateFlowSuggestionsButton() {
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
            const result = await generateFlowSuggestionsAction();
            if (result.error) setError(result.error);
            else setMessage(result.message ?? 'Done.');
          })
        }
      >
        {pending ? 'Reading your conversations…' : 'Look for suggestions now'}
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

const acceptInitial: AcceptSuggestionState = {};

/**
 * Accepting always ends in the builder.
 *
 * The flow arrives as a draft written from six example messages by something
 * that has never seen this business's prices — so the next thing that has to
 * happen is a person reading it. Landing on the flows list instead would leave
 * the owner to find it, and a suggestion accepted but never opened is a draft
 * that sits there forever.
 */
export function AcceptFlowSuggestionForm({ suggestionId }: { suggestionId: string }) {
  const [state, action] = useFormState(acceptFlowSuggestionAction, acceptInitial);
  const router = useRouter();

  useEffect(() => {
    if (state.ok && state.flowId) router.push(`/company/flows/${state.flowId}`);
  }, [state.ok, state.flowId, router]);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={suggestionId} />
      <SubmitButton size="sm" pendingLabel="Creating the draft…">
        Build this guided chat
      </SubmitButton>
      <FormMessage state={{ error: state.error }} />
    </form>
  );
}

const dismissInitial: ActionState = {};

const REASONS: Array<{ value: string; label: string }> = [
  { value: 'already_answered', label: 'We already answer this fine' },
  { value: 'not_worth_a_flow', label: 'Not worth a guided chat' },
  { value: 'wrong_grouping', label: 'These are not the same question' },
  { value: 'bad_draft', label: 'The draft chat is not right' },
  { value: 'other', label: 'Something else' },
];

/**
 * Dismissing asks why, and the answer is kept.
 *
 * Not for a report nobody reads: a dismissed suggestion is stored forever
 * against the same fingerprint, which is what stops the identical topic coming
 * back next week. The reason is what lets somebody understand a decision they
 * made two months ago when they see the topic again in their own reports.
 *
 * The form stays folded until asked for, because "no" should not be as loud as
 * "yes" on a screen whose whole purpose is the suggestion.
 */
export function DismissFlowSuggestionForm({ suggestionId }: { suggestionId: string }) {
  const [state, action] = useFormState(dismissFlowSuggestionAction, dismissInitial);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Not for us
      </Button>
    );
  }

  return (
    <form action={action} className="w-full max-w-md space-y-3 rounded-md border p-3">
      <input type="hidden" name="id" value={suggestionId} />
      <FormField
        label="Why not?"
        htmlFor={`dismiss-reason-${suggestionId}`}
        required
        hint="This one will not be suggested again. The reason is only so it makes sense later."
      >
        <Select id={`dismiss-reason-${suggestionId}`} name="reason" size="sm" defaultValue="not_worth_a_flow">
          {REASONS.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Anything to add?" htmlFor={`dismiss-note-${suggestionId}`}>
        <Textarea
          id={`dismiss-note-${suggestionId}`}
          name="note"
          rows={2}
          maxLength={300}
          placeholder="Optional"
        />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <SubmitButton size="sm" variant="outline" pendingLabel="Dismissing…">
          Dismiss it
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Keep it
        </Button>
      </div>
      <FormMessage state={state} okText={state.message ?? 'Dismissed.'} />
    </form>
  );
}
